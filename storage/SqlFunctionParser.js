const fs = require('fs');
const path = require('path');
const Entity = require('./Entity');
const { DBType, DBNumber, DBString, DBBool, DBDateTime } = require('./DataTypes');

class SqlFunctionParser {
    /**
     * @param {Object} adapter - The database adapter instance (must implement required interface) - 数据库适配器实例（必须实现所需接口）
     */
    constructor(adapter) {
        this.entities = {};
        this.transactions = {};
        this.adapter = adapter;
        this.relationRegistry = []; // Stores { source, target, table, sourceCol, targetCol } - 存储关系信息 { 源实体, 目标实体, 表名, 源列名, 目标列名 }
    }

    /**
     * Parse database definitions from a single source text. - 从单个源文本解析数据库定义。
     * @param {string} sourceText - The concatenated content of .st and .dtf files. - .st和.dtf文件的拼接内容。
     * @returns {Object} An object containing executable transaction functions. - 包含可执行事务函数的对象。
     */
    async parse(sourceText) {
        // Pass 1: Parse all Table Definitions - 第一阶段：解析所有表定义
        const lines = sourceText.split('\n');
        await this.parseTables(lines);
        
        // Pass 2: Validate Schema Integrity - 第二阶段：验证架构完整性
        this.validateSchema();

        // Pass 3: Generate Triggers (Orphan Removal) - 第三阶段：生成触发器（孤儿删除）
        await this.generateTriggers();

        // Pass 4: Parse Transactions - 第四阶段：解析事务
        this.parseTransactions(lines);

        return this.generateApi();
    }
    
    /**
     * Close the parser and underlying resources. - 关闭解析器和底层资源。
     */
    async close() {
        if (this.adapter && typeof this.adapter.close === 'function') {
            await this.adapter.close();
        }
    }

    /**
     * Parse table definitions from lines of source text. - 从源文本行解析表定义。
     * @param {Array<string>} lines - The lines of source text. - 源文本的行。
     */
    async parseTables(lines) {
        let currentEntity = null;
        const relationsToSync = []; // Defer relation sync until all entities are known - 延迟关系同步，直到所有实体都已知

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#') || line.startsWith('//')) continue;

            // Entity definition start: User{ or User(Owner) { - 实体定义开始：User{ 或 User(Owner) {
            // No explicit [entry] keyword needed. Entities without owners are independent by default. - 不需要显式的[entry]关键字。默认情况下，没有所有者的实体是独立的。
            const entityMatch = line.match(/^(\w+)\s*(?:\(([\w,\s]+)\))?\s*\{/);
            if (entityMatch) {
                currentEntity = entityMatch[1];
                const ownersStr = entityMatch[2];
                // Clean up owners list
                const owners = ownersStr ? ownersStr.split(',').map(s => s.trim()) : [];
                this.entities[currentEntity] = { fields: {}, relations: [], owners };
                continue;
            }

            // Entity definition end: } - 实体定义结束：}
            if (line === '}') {
                if (currentEntity) {
                    // Sync Schema to DB (Main Table)
                    await this.adapter.ensureTable(currentEntity, this.entities[currentEntity]);
                }
                currentEntity = null;
                continue;
            }

            if (currentEntity) {
                // Type Parsing: type:name ... - 类型解析：type:name ...
                const typeMatch = line.match(/^(\w+(?:\[[^\]]+\])?|List\[[^\]]+\]):(\w+)/i);
                if (typeMatch) {
                    const fullType = typeMatch[1];
                    const fieldName = typeMatch[2];
                    
                    let fieldDef = {
                        name: fieldName,
                        rawType: fullType,
                        defaultValue: null
                    };

                    const remainder = line.substring(typeMatch[0].length);
                    const defaultMatch = remainder.match(/\((.*?)\)/);
                    if (defaultMatch) {
                        fieldDef.defaultValue = defaultMatch[1];
                    }
                    
                    // Capture Attributes like [primary], [not null], [unique] - 捕获属性如[primary]、[not null]、[unique]
                    if (remainder.includes('[primary]')) {
                        fieldDef.rawType += ' [primary]';
                    }
                    if (remainder.includes('[not null]')) {
                        fieldDef.rawType += ' [not null]';
                    }
                    if (remainder.includes('[unique]')) {
                        fieldDef.rawType += ' [unique]';
                    }

                    if (fullType.toLowerCase().startsWith('list[')) {
                        const targetEntity = fullType.substring(5, fullType.length - 1);
                        this.entities[currentEntity].relations.push({
                            field: fieldName,
                            target: targetEntity
                        });
                        relationsToSync.push({ source: currentEntity, target: targetEntity });
                    } else {
                        this.entities[currentEntity].fields[fieldName] = fieldDef;
                    }
                }
            }
        }
        
        // Pass 1.5: Sync Relations (N-N Tables) - 第1.5阶段：同步关系（多对多表）
        // Now that all entities and their PKs are known - 现在所有实体及其主键都已知
        for (const rel of relationsToSync) {
            const srcDef = this.entities[rel.source];
            const tgtDef = this.entities[rel.target];
            
            if (!tgtDef) {
                console.warn(`[Schema] Warning: Skipping relation ${rel.source}->${rel.target} because target entity is not defined.`);
                continue;
            }
            
            const srcPk = Object.keys(srcDef.fields).find(f => srcDef.fields[f].rawType.includes('[primary]'));
            const tgtPk = Object.keys(tgtDef.fields).find(f => tgtDef.fields[f].rawType.includes('[primary]'));
            
            if (srcPk && tgtPk) {
                await this.adapter.ensureRelationTable(rel.source, rel.target, srcPk, tgtPk);
                
                // Register Relation Details for Triggers
                // Re-calculate table name and columns as adapter does
                const [e1, e2] = [rel.source, rel.target].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                const k1 = (e1 === rel.source) ? srcPk : tgtPk;
                const k2 = (e2 === rel.target) ? tgtPk : srcPk;
                const tableName = `${e1.toLowerCase()}_${e2.toLowerCase()}`;
                const col1 = `${e1.toLowerCase()}_${k1}`;
                const col2 = `${e2.toLowerCase()}_${k2}`;
                
                // Store BOTH directions for easier lookup
                // Source -> Target
                this.relationRegistry.push({
                    source: rel.source,
                    target: rel.target,
                    table: tableName,
                    sourceCol: (rel.source === e1) ? col1 : col2,
                    targetCol: (rel.target === e2) ? col2 : col1
                });
                
                // Target -> Source
                this.relationRegistry.push({
                    source: rel.target,
                    target: rel.source,
                    table: tableName,
                    sourceCol: (rel.target === e2) ? col2 : col1,
                    targetCol: (rel.source === e1) ? col1 : col2
                });

            } else {
                console.warn(`[Schema] Warning: Cannot create relation table for ${rel.source}-${rel.target} due to missing Primary Keys.`);
            }
        }
    }

    /**
     * Generate database triggers for orphan removal. - 为孤儿删除生成数据库触发器。
     */
    async generateTriggers() {
        for (const [entityName, def] of Object.entries(this.entities)) {
            // Only process entities with defined Owners - 只处理有定义所有者的实体
            if (!def.owners || def.owners.length === 0) continue;
            
            // Collect all relations linking this entity to its owners - 收集将此实体链接到其所有者的所有关系
            // We look for relations where target == entityName AND source is in owners - 我们查找目标==entityName且源在所有者中的关系
            // OR source == entityName AND target is in owners (if relation defined inversely) - 或者源==entityName且目标在所有者中（如果关系是反向定义的）
            
            const relevantRelations = [];
            const pkField = Object.keys(def.fields).find(f => def.fields[f].rawType.includes('[primary]'));
            if (!pkField) {
                console.warn(`[Triggers] Cannot create orphan trigger for ${entityName} (No PK)`);
                continue;
            }

            for (const owner of def.owners) {
                // Find relation table connecting Owner and Entity - 查找连接所有者和实体的关系表
                // We can use relationRegistry. - 我们可以使用relationRegistry
                // We need the registry entry where 'target' is THIS entity (so we know the column name for this entity) - 我们需要'registry'条目，其中'target'是这个实体（这样我们就知道这个实体的列名）
                // and 'source' is the Owner. - 并且'source'是所有者
                // Note: relationRegistry stores both directions. - 注意：relationRegistry存储两个方向
                
                const rel = this.relationRegistry.find(r => r.source === owner && r.target === entityName);
                
                if (rel) {
                    relevantRelations.push({
                        table: `"${rel.table}"`, // Quote table name - 引用表名
                        col: `"${rel.targetCol}"` // The column in junction table that points to THIS entity - 连接表中指向此实体的列
                    });
                } else {
                    console.warn(`[Triggers] Warning: Entity '${entityName}' declares owner '${owner}', but no relation found between them.`);
                }
            }
            
            if (relevantRelations.length > 0) {
                // For each owner relation table, we create a trigger on IT. - 对于每个所有者关系表，我们在其上创建一个触发器
                // The trigger checks ALL relevantRelations. - 触发器检查所有相关关系
                
                for (const rel of relevantRelations) {
                    // Trigger Source: The junction table for ONE owner - 触发器源：一个所有者的连接表
                    // We delete from THAT junction table -> Check if Entity is still referenced in ANY junction table - 我们从该连接表中删除 -> 检查实体是否仍在任何连接表中被引用
                    
                    // rel.table is e.g. "class_student" - rel.table例如"class_student"
                    // rel.col is e.g. "student_id" - rel.col例如"student_id"
                    
                    await this.adapter.ensureOrphanTrigger(
                        entityName,
                        pkField,
                        rel.table,
                        rel.col.replace(/"/g, ''), // adapter re-quotes or handles it - adapter重新引用或处理它
                        relevantRelations.map(r => ({ table: r.table, col: r.col }))
                    );
                }
            }
        }
    }

    /**
     * Validate the schema for integrity. - 验证架构的完整性。
     */
    validateSchema() {
        for (const [entityName, def] of Object.entries(this.entities)) {
            for (const rel of def.relations) {
                if (!this.entities[rel.target]) {
                    throw new Error(`Schema Integrity Error: Entity '${entityName}' references unknown entity '${rel.target}' in field '${rel.field}'.`);
                }
            }
        }
    }

    /**
     * Parse transaction definitions from lines of source text. - 从源文本行解析事务定义。
     * @param {Array<string>} lines - The lines of source text. - 源文本的行。
     */
    parseTransactions(lines) {
        let currentTx = null;
        let rootBlock = [];
        let stack = [{ indent: -1, block: rootBlock }];

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) continue;

            const indentLevel = rawLine.match(/^\s*/)[0].length;

            // Check for Function Definition (Start of new transaction) - 检查函数定义（新事务开始）
            if (trimmedLine.match(/^\w+\(.*\):$/)) {
                const nameMatch = trimmedLine.match(/^(\w+)\((.*)\):$/);
                const name = nameMatch[1];
                const paramsStr = nameMatch[2];
                
                currentTx = {
                    name: name,
                    params: this.parseParams(paramsStr),
                    body: [],
                    type: 'Transaction'
                };
                this.transactions[name] = currentTx;
                
                stack = [{ indent: -1, block: [] }, { indent: indentLevel, block: currentTx.body }];
                continue;
            }
            
            // Skip lines inside Entity definitions (already parsed) - 跳过实体定义内的行（已解析）
            if (trimmedLine.endsWith('{') || trimmedLine === '}') continue;
            // Also skip field definitions if we are not in a transaction - 如果不在事务中，也跳过字段定义
            if (!currentTx && trimmedLine.includes(':')) continue;

            if (!currentTx) continue; 

            // Indentation handling - 缩进处理
            while (stack.length > 1 && indentLevel <= stack[stack.length - 1].indent) {
                stack.pop();
            }
            
            const currentBlock = stack[stack.length - 1].block;
            const stmt = this.parseStatement(trimmedLine);
            stmt.indent = indentLevel;
            currentBlock.push(stmt);

            if (trimmedLine.endsWith(':')) {
                stmt.body = [];
                stack.push({ indent: indentLevel, block: stmt.body });
            }
        }
    }

    /**
     * Parse parameters string into parameter definitions. - 将参数字符串解析为参数定义。
     * @param {string} paramsStr - The parameters string. - 参数字符串。
     * @returns {Array<Object>} An array of parameter definitions. - 参数定义的数组。
     */
    parseParams(paramsStr) {
        if (!paramsStr.trim()) return [];
        return paramsStr.split(/,(?![^\[]*\])/).map(p => {
            const parts = p.trim().split(':');
            if (parts.length < 2) return { name: p.trim(), type: 'any' };
            
            const type = parts[0].trim();
            const rest = parts.slice(1).join(':').trim();
            
            const nameMatch = rest.match(/^(\w+)/);
            const name = nameMatch ? nameMatch[1] : rest;
            
            // Default value - 默认值
            let defaultValue = null;
            const defaultMatch = rest.match(/\((.*?)\)/);
            if (defaultMatch) defaultValue = defaultMatch[1];

            return { name, type, defaultValue };
        });
    }

    /**
     * Parse a single statement line into an AST node. - 将单个语句行解析为AST节点。
     * @param {string} line - The statement line. - 语句行。
     * @returns {Object} The parsed AST node. - 解析后的AST节点。
     */
    parseStatement(line) {
        // Remove trailing colon if present - 如果存在，移除尾部冒号
        const cleanLine = line.endsWith(':') ? line.slice(0, -1) : line;
        
        // Basic Regex Parsers - 基本正则解析器
        if (cleanLine.match(/^Get /)) {
            // Get a user by id of {id} as user - Get a user by id of {id} as user
            const match = cleanLine.match(/Get (?:a|an|the)?\s*(\[?[\w]+\]?s?)\s*(?:by|where|from)?\s*(.*)\s*as\s+(\w+)/i);
            if (match) {
                return { type: 'Get', entity: match[1], condition: match[2], alias: match[3], raw: line };
            }
            return { type: 'Get', raw: line };
        }
        
        if (cleanLine.match(/^Create /)) {
             // Create a Item with id of {id} ... - Create a Item with id of {id} ...
             // Raw: Create a Item with id of {id} and name of {name} and price of {price} as newItem - Raw: Create a Item with id of {id} and name of {name} and price of {price} as newItem
             return { type: 'Create', raw: line };
        }
        
        if (cleanLine.match(/^Update /)) {
             // Update item to set price = {newPrice} - Update item to set price = {newPrice}
             return { type: 'Update', raw: line };
        }

        if (cleanLine.match(/^If /)) {
             const condition = cleanLine.substring(3).trim();
             return { type: 'If', condition: condition, raw: line };
        }
        
        if (cleanLine.match(/^For Each /)) {
            // Support dot notation in list variable: {cart.items} - 支持列表变量中的点表示法：{cart.items}
            const match = cleanLine.match(/For Each (\w+) in (\{?[\w\.]+\}?)/i);
            return { type: 'ForEach', item: match ? match[1] : 'item', list: match ? match[2] : 'list', raw: line };
        }
        
        if (cleanLine.match(/^Set /)) {
            // Set {var} = val - Set {var} = val
            const match = cleanLine.match(/Set \{(\w+)\} = (.*)/);
            return { type: 'Set', var: match ? match[1] : null, value: match ? match[2] : null, raw: line };
        }
        
        if (cleanLine.match(/^return /)) {
             return { type: 'Return', value: cleanLine.substring(7).trim(), raw: line };
        }

        return { type: 'Expression', raw: line };
    }

    /**
     * Generate API object with executable transaction functions. - 生成包含可执行事务函数的API对象。
     * @returns {Object} An object containing executable transaction functions. - 包含可执行事务函数的对象。
     */
    generateApi() {
        const api = {};
        for (const [name, tx] of Object.entries(this.transactions)) {
            api[name] = async (args = {}) => {
                return this.executeTransaction(tx, args);
            };
        }
        return api;
    }

    /**
     * Execute a transaction function with given arguments. - 使用给定参数执行事务函数。
     * @param {Object} tx - The transaction definition. - 事务定义。
     * @param {Object} args - The arguments to pass to the transaction. - 传递给事务的参数。
     * @returns {any} The result of the transaction execution. - 事务执行的结果。
     */
    async executeTransaction(tx, args) {
        console.log(`[EXEC] Starting Transaction: ${tx.name}`);
        const context = { vars: {}, entities: this.entities, adapter: this.adapter };
        
        // Initialize Params - 初始化参数
        for (const p of tx.params) {
            let val = args[p.name];
            
            // Check if passed val is already DBType, if not wrap it (for testing convenience) - 检查传递的val是否已经是DBType，如果不是则包装它（为了测试方便）
            if (val !== undefined && !(val instanceof DBType)) {
                val = this.wrapValue(val, p.type);
            }

            if (val === undefined && p.defaultValue) {
                val = await this.parseValue(p.defaultValue, context);
            }
            
            if (val === undefined && p.type.startsWith('list')) {
                throw new Error(`Missing required list parameter: ${p.name}`);
            }
            context.vars[p.name] = val;
        }

        // Execute Body with Transaction Safety - 使用事务安全执行主体
        try {
            // Start REAL DB Transaction - 开始真实的数据库事务
            await this.adapter.beginTransaction();
            
            const result = await this.executeBlock(tx.body, context);
            
            // Commit if successful - 如果成功则提交
            await this.adapter.commit();
            return result;
        } catch (e) {
            // Rollback on any error - 任何错误都回滚
            console.error(`[EXEC] Error in ${tx.name}, rolling back:`, e.message);
            await this.adapter.rollback();
            throw e;
        }
    }

    /**
     * Execute a block of statements. - 执行语句块。
     * @param {Array<Object>} block - The block of statements to execute. - 要执行的语句块。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {any} The result if any statement returns a value. - 如果任何语句返回值，则返回该结果。
     */
    async executeBlock(block, context) {
        for (const stmt of block) {
            const result = await this.executeStatement(stmt, context);
            if (result && result.type === 'RETURN') {
                return result.value;
            }
        }
    }

    /**
     * Execute a single statement. - 执行单个语句。
     * @param {Object} stmt - The statement to execute. - 要执行的语句。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {Object|null} The result if the statement returns a value. - 如果语句返回值，则返回该结果。
     */
    async executeStatement(stmt, context) {
        // Resolve variables in raw string for logging - 解析原始字符串中的变量用于日志记录
        // console.log(`[EXEC] ${stmt.raw}`);

        switch (stmt.type) {
            case 'Get':
                return this.handleGet(stmt, context);
            case 'Create':
                return this.handleCreate(stmt, context);
            case 'Update':
                return this.handleUpdate(stmt, context);
            case 'Set':
                return this.handleSet(stmt, context);
            case 'If':
                // If block might return a value (which means early return from function) - If块可能返回一个值（这意味着从函数提前返回）
                const ifResult = await this.handleIf(stmt, context);
                if (ifResult && ifResult.type === 'RETURN') {
                     return ifResult;
                }
                break;
            case 'ForEach':
                const loopResult = await this.handleForEach(stmt, context);
                if (loopResult && loopResult.type === 'RETURN') {
                     return loopResult;
                }
                break;
            case 'Return':
                let val = await this.resolveValue(stmt.value, context);
                // If returning Entity, serialize it to avoid leaking internal structure (and resolve promises) - 如果返回Entity，将其序列化以避免泄露内部结构（并解析Promise）
                if (val instanceof Entity) {
                    val = await val.toJSON();
                } else if (Array.isArray(val)) {
                    val = await Promise.all(val.map(async v => v instanceof Entity ? await v.toJSON() : v));
                }
                return { type: 'RETURN', value: val };
            default:
                break;
        }
    }

    // --- Handlers --- - --- 处理器 ---

    /**
     * Handle Get statement execution. - 处理Get语句执行。
     * @param {Object} stmt - The Get statement AST node. - Get语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     */
    async handleGet(stmt, context) {
        // Parse: Get a user by id of {id} as targetUser - 解析：Get a user by id of {id} as targetUser
        // Simplified Logic: - 简化逻辑：
        // 1. Identify Entity Type - 1. 识别实体类型
        let entityType = stmt.entity.replace(/\[|\]/g, '').replace(/^a |^an |^the /i, '');
        if (entityType.endsWith('s')) entityType = entityType.slice(0, -1); // De-pluralize roughly - 大致去复数
        
        // Normalize entity type (Capitalize first letter) - 规范化实体类型（首字母大写）
        const entityDefName = Object.keys(this.entities).find(k => k.toLowerCase() === entityType.toLowerCase());
        
        if (!entityDefName) {
            console.warn(`[EXEC] Unknown entity type: ${entityType}`);
            return;
        }

        // 2. Query Adapter - 2. 查询适配器
        // Assuming "by id of {id}" - 假设 "by id of {id}"
        const idMatch = stmt.raw.match(/by id of \{(\w+)\}/);
        let result = null;
        
        if (idMatch) {
            const varName = idMatch[1];
            const idValObj = context.vars[varName]; // Should be DBType - 应该是DBType
            const idVal = idValObj ? idValObj.getValue() : null; // Raw value for DB query - 用于数据库查询的原始值
            
            // Assume first field is ID - 假设第一个字段是ID
            const idField = Object.keys(this.entities[entityDefName].fields)[0];
            
            // Adapter query - 适配器查询
            const record = await context.adapter.findOne(entityDefName, { [idField]: idVal });
            
            if (record) {
                // Pass loader for lazy relations - 为延迟关系传递加载器
                const loader = async (entity, relation) => {
                    const targetEntity = relation.target;
                    
                    // Determine Source Entity Name - 确定源实体名称
                    const sourceEntityName = entity._type.name || Object.keys(this.entities).find(k => this.entities[k] === entity._type);
                    if (!sourceEntityName) throw new Error("Cannot determine entity type for lazy loading");

                    // Determine Table Name (Alphabetical Order) - 确定表名（字母顺序）
                    const [e1, e2] = [sourceEntityName, targetEntity].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                    const tableName = `${e1.toLowerCase()}_${e2.toLowerCase()}`;

                    // Determine Source PK Value - 确定源主键值
                    const srcPkField = Object.keys(entity._type.fields).find(f => entity._type.fields[f].rawType.includes('[primary]'));
                    if (!srcPkField) return [];
                    const srcPkVal = entity.get(srcPkField).getValue();

                    // Determine Target PK Field - 确定目标主键字段
                    const tgtDef = this.entities[targetEntity];
                    const tgtPkField = Object.keys(tgtDef.fields).find(f => tgtDef.fields[f].rawType.includes('[primary]'));
                    
                    // Determine Column Names in Intermediate Table - 确定中间表中的列名
                    // Format: entity_pk - 格式：entity_pk
                    const srcCol = `${sourceEntityName.toLowerCase()}_${srcPkField}`;
                    const tgtCol = `${targetEntity.toLowerCase()}_${tgtPkField}`;
                    
                    // 1. Find all target IDs from intermediate table - 1. 从中间表查找所有目标ID
                    // SELECT {tgtCol} FROM {tableName} WHERE {srcCol} = {srcPkVal}
                    const joinRows = await context.adapter.find(tableName, { [srcCol]: srcPkVal });
                    
                    if (!joinRows || joinRows.length === 0) return [];
                    
                    const targetIds = joinRows.map(r => r[tgtCol]);
                    
                    // 2. Find all target entities - 2. 查找所有目标实体
                    // Optimization: We could add 'findIn' to adapter, but for now loop/Promise.all is fine - 优化：我们可以向适配器添加'findIn'，但现在循环/Promise.all就可以了
                    const results = await Promise.all(targetIds.map(id => 
                        context.adapter.findOne(targetEntity, { [tgtPkField]: id })
                    ));
                    
                    // Filter out nulls and wrap in Entity - 过滤掉null并包装到Entity中
                    return results
                        .filter(r => r)
                        .map(r => new Entity(this.entities[targetEntity], r, true, loader));
                };

                result = new Entity(this.entities[entityDefName], record, true, loader);
            }
        }

        // 3. Set Alias - 3. 设置别名
        if (stmt.alias) {
            context.vars[stmt.alias] = result;
        }
    }

    /**
     * Handle Create statement execution. - 处理Create语句执行。
     * @param {Object} stmt - The Create statement AST node. - Create语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     */
    async handleCreate(stmt, context) {
        // Create a user with a name of {name} ... as newUser - Create a user with a name of {name} ... as newUser
        const match = stmt.raw.match(/Create (?:a|an) (\w+)/i);
        if (!match) return;
        
        const entityType = match[1];
        const entityDefName = Object.keys(this.entities).find(k => k.toLowerCase() === entityType.toLowerCase());
        
        if (!entityDefName) {
            console.error(`[EXEC] Unknown entity type in Create: ${entityType}`);
            return;
        }
        
        const newData = {};
        const withParts = stmt.raw.split(' with ')[1];
        if (withParts) {
            // Split by 'and' - 按'and'分割
            const assignments = withParts.split(/ and /i);
            for (const assign of assignments) {
                // a name of {val} - a name of {val}
                const parts = assign.trim().split(' of ');
                if (parts.length === 2) {
                    const fieldName = parts[0].replace(/^(?:a|an) /i, '').trim();
                    const valExpr = parts[1].split(' as ')[0].trim();
                    const val = await this.resolveValue(valExpr, context);
                    // Store raw value for Adapter - 为适配器存储原始值
                    newData[fieldName] = val instanceof DBType ? val.getValue() : val;
                }
            }
        }
        
        if (entityDefName) {
            await context.adapter.insert(entityDefName, newData);
            
            // Create Entity with isRef=true to point to the new record - 创建isRef=true的Entity以指向新记录
            // Re-fetch raw data to ensure type consistency (optional but safer) - 重新获取原始数据以确保类型一致性（可选但更安全）
            // Or just use newData. - 或者只使用newData
            // Note: Entity constructor wraps raw values into DBTypes - 注意：Entity构造函数将原始值包装到DBTypes中
            const entity = new Entity(this.entities[entityDefName], newData, true);
            
            const asMatch = stmt.raw.match(/ as (\w+)$/i);
            if (asMatch) {
                context.vars[asMatch[1]] = entity;
            }
        }
    }

    /**
     * Handle Update statement execution. - 处理Update语句执行。
     * @param {Object} stmt - The Update statement AST node. - Update语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     */
    async handleUpdate(stmt, context) {
        // Update the targetUser to set name = {new_name} - Update the targetUser to set name = {new_name}
        const match = stmt.raw.match(/Update (?:the )?(\w+) to set (.*)/i);
        if (match) {
            const varName = match[1];
            const setClause = match[2];
            
            const entity = context.vars[varName];
            if (entity && entity instanceof Entity) {
                const updates = {};
                const assignments = setClause.split(',');
                
                for (const assign of assignments) {
                    const [field, valExpr] = assign.split('=').map(s => s.trim());
                    const val = await this.resolveValue(valExpr, context); 
                    
                    // Critical: Update in-memory entity with correct DBType - 关键：使用正确的DBType更新内存中的实体
                    // This ensures subsequent reads in same transaction see the update - 这确保同一事务中的后续读取能看到更新
                    entity.set(field, val); 
                    
                    // Prepare raw value for DB - 准备用于数据库的原始值
                    updates[field] = val instanceof DBType ? val.getValue() : val;
                }
                
                // Determine PK - 确定主键
                const pkField = Object.keys(this.entities[entity._type.name || Object.keys(this.entities).find(k => this.entities[k] === entity._type)].fields)[0];
                const pkVal = entity.get(pkField).getValue();
                
                // Execute Update - 执行更新
                const entityName = Object.keys(this.entities).find(k => this.entities[k] === entity._type);
                await context.adapter.update(entityName, { [pkField]: pkVal }, updates);
            }
        }
    }

    /**
     * Handle Set statement execution. - 处理Set语句执行。
     * @param {Object} stmt - The Set statement AST node. - Set语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     */
    async handleSet(stmt, context) {
        // Set {var} = val - Set {var} = val
        if (stmt.var) {
            const val = await this.resolveValue(stmt.value, context); // Returns DBType - 返回DBType
            context.vars[stmt.var] = val;
        }
    }

    /**
     * Handle If statement execution. - 处理If语句执行。
     * @param {Object} stmt - The If statement AST node. - If语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {Object|null} The result if the If block returns a value. - 如果If块返回值，则返回该结果。
     */
    async handleIf(stmt, context) {
        const condVal = await this.evaluateCondition(stmt.condition, context);
        if (condVal) {
            const result = await this.executeBlock(stmt.body, context);
            if (result !== undefined) {
                return { type: 'RETURN', value: result };
            }
        }
    }

    /**
     * Handle ForEach statement execution. - 处理ForEach语句执行。
     * @param {Object} stmt - The ForEach statement AST node. - ForEach语句AST节点。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {Object|null} The result if the ForEach block returns a value. - 如果ForEach块返回值，则返回该结果。
     */
    async handleForEach(stmt, context) {
        // Parse: For Each item in list - 解析：For Each item in list
        // stmt.item = 'item', stmt.list = 'list'
        
        // Remove braces if user put them, e.g. "in {cart.items}" -> "cart.items" - 如果用户添加了大括号，则移除，例如 "in {cart.items}" -> "cart.items"
        // Because resolveValue expects "{var}" for variables, but maybe stmt.list captured the braces? - 因为resolveValue期望变量使用"{var}"，但stmt.list可能捕获了大括号？
        // Let's check parseStatement regex. - 让我们检查parseStatement正则表达式
        // regex: /For Each (\w+) in (\{?\w+\}?)/i
        // It captures "{? \w+ }? " 
        // If input is "{cart.items}", regex `\w+` DOES NOT MATCH dot. - 如果输入是"{cart.items}"，正则表达式`\w+`不匹配点
        // So `stmt.list` might be partial or broken. - 所以`stmt.list`可能是部分或损坏的
        
        // Let's fix the Regex in parseStatement first. - 让我们先修复parseStatement中的正则表达式
        
        const listVal = await this.resolveValue(stmt.list, context);
        
        if (!Array.isArray(listVal)) {
            // It might be a single entity or null, but ForEach expects iterable - 它可能是单个实体或null，但ForEach期望可迭代对象
            if (listVal === null || listVal === undefined) return; 
            console.warn(`[EXEC] ForEach expects array, got ${typeof listVal}`);
            return;
        }

        for (const item of listVal) {
            // Create a new scope? Or just reuse context? - 创建新作用域？还是重用上下文？
            // Usually Loop creates a scope for the iterator variable. - 通常循环为迭代器变量创建作用域
            // But for simplicity, we can use the same context vars, - 但为了简单起见，我们可以使用相同的上下文变量
            // overwriting the loop var. - 覆盖循环变量
            // CAUTION: This means the loop var leaks after the loop. - 注意：这意味着循环变量会在循环后泄漏
            // To prevent this, we should restore it or use a child context. - 为了防止这种情况，我们应该恢复它或使用子上下文
            // Let's use child context for safety. - 为了安全起见，我们使用子上下文
            
            // Shallow copy vars for new scope - 为新作用域浅拷贝变量
            // Actually, we want to modify outer variables (like sum), - 实际上，我们想要修改外部变量（如sum）
            // but the loop variable itself should be local-ish? - 但循环变量本身应该是局部的？
            // In most languages, modifying outer vars is allowed. - 在大多数语言中，允许修改外部变量
            // So we just set the loop var. - 所以我们只设置循环变量
            
            context.vars[stmt.item] = item;
            
            const result = await this.executeBlock(stmt.body, context);
            if (result !== undefined) {
                return { type: 'RETURN', value: result };
            }
        }
    }

    // --- Helpers --- - --- 辅助函数 ---

    /**
     * Wrap a raw value into the appropriate DBType based on the given type string. - 根据给定的类型字符串将原始值包装到适当的DBType中。
     * @param {any} val - The raw value to wrap. - 要包装的原始值。
     * @param {string} type - The type string. - 类型字符串。
     * @returns {DBType} The wrapped DBType value. - 包装后的DBType值。
     */
    wrapValue(val, type) {
        if (val instanceof DBType) return val;
        
        if (type && type.toLowerCase().startsWith('number')) {
            // Extract constraints if available in type string (e.g. from param def) - 从类型字符串中提取约束（例如从参数定义中）
            // But usually parseParams just gives 'number' or 'number[10.2]' - 但通常parseParams只给出'number'或'number[10.2]'
            let precision = null;
            let scale = null;
            const match = type.match(/number\[(\d+)(?:\.(\d+))?\]/i);
            if (match) {
                precision = parseInt(match[1]);
                scale = match[2] ? parseInt(match[2]) : 0;
            }
            return new DBNumber(val, precision, scale);
        }
        
        if (type && type.toLowerCase().startsWith('str')) {
             let maxLength = null;
             const match = type.match(/str\[(\d+)\]/i);
             if (match) {
                 maxLength = parseInt(match[1]);
             }
             return new DBString(val, maxLength);
        }
        
        if (type && type.toLowerCase().startsWith('bool')) return new DBBool(val);
        if (type && type.toLowerCase().startsWith('datetime')) return new DBDateTime(val);
        
        // Auto-detect - 自动检测
        if (typeof val === 'number') return new DBNumber(val);
        if (typeof val === 'boolean') return new DBBool(val);
        return new DBString(val);
    }

    /**
     * Resolve an expression string to a value using the given context. - 使用给定上下文将表达式字符串解析为值。
     * @param {string} expr - The expression string to resolve. - 要解析的表达式字符串。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {any} The resolved value. - 解析后的值。
     */
    async resolveValue(expr, context) {
        if (!expr) return null;
        expr = expr.trim();
        
        // Variable {var}
        const varMatch = expr.match(/^\{([\w\.]+)\}$/);
        if (varMatch) {
            const path = varMatch[1].split('.');
            const rootVar = path[0];
            let val = context.vars[rootVar];
            
            // Strict check: Root variable must exist - 严格检查：根变量必须存在
            if (val === undefined) {
                 throw new Error(`Variable '${rootVar}' is undefined`);
            }
            
            if (path.length > 1 && val instanceof Entity) {
                // If accessing property of Entity, it might trigger lazy load (async) - 如果访问Entity的属性，可能会触发延迟加载（异步）
                val = val.get(path[1]); 
                if (val instanceof Promise) {
                    val = await val;
                }
            } else if (path.length > 1 && val) {
                val = val[path[1]];
            }
            
            return val;
        }
        
        // Literal
        if (expr === 'true') return new DBBool(true);
        if (expr === 'false') return new DBBool(false);
        if (expr.startsWith("'") || expr.startsWith('"')) return new DBString(expr.slice(1, -1));
        if (!isNaN(expr)) return new DBNumber(expr);
        
        // Expression Evaluation (Only if operators present) - 表达式求值（仅当存在运算符时）
        // Check for math operators to avoid recursion on simple non-variable strings that failed regex - 检查数学运算符，避免在简单的非变量字符串上递归失败
        if (/[+\-\*\/]/.test(expr)) {
             return this.evaluateExpression(expr, context);
        }
        
        // If we reached here, it's a string that is neither a variable {x}, nor a number, nor a bool, nor a quoted string. - 如果我们到达这里，它是一个既不是变量{x}，也不是数字，也不是布尔值，也不是引号字符串的字符串
        // e.g. "foo" (unquoted) - 例如 "foo"（未引用）
        // This should probably be an error or treated as string? - 这可能应该是错误或被视为字符串？
        // In this DSL, unquoted strings are not really supported unless they are keywords (true/false). - 在此DSL中，除非是关键字（true/false），否则不真正支持未引用的字符串
        // But maybe the user wrote `Set {x} = foo` (forgot quotes). - 但也许用户写了`Set {x} = foo`（忘记引号）
        
        throw new Error(`Unrecognized value or expression: "${expr}"`);
    }

    /**
     * Evaluate an expression string using the given context. - 使用给定上下文评估表达式字符串。
     * @param {string} expr - The expression string to evaluate. - 要评估的表达式字符串。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {DBType} The result of the expression evaluation. - 表达式评估的结果。
     */
    async evaluateExpression(expr, context) {
        // Simple Recursive Descent Parser or Shunting Yard - 简单的递归下降解析器或分流场算法
        // Supporting +, -, *, / and parentheses - 支持 +, -, *, / 和括号
        
        // 1. Tokenize - 1. 标记化
        const tokens = this.tokenize(expr);
        
        // 2. Shunting Yard to RPN - 2. 分流场算法转换为逆波兰表示法
        const rpn = this.shuntingYard(tokens);
        
        // 3. Evaluate RPN - 3. 评估逆波兰表示法
        return this.evaluateRPN(rpn, context);
    }

    /**
     * Tokenize an expression string into tokens. - 将表达式字符串标记化为标记。
     * @param {string} expr - The expression string to tokenize. - 要标记化的表达式字符串。
     * @returns {Array<Object>} An array of tokens. - 标记的数组。
     */
    tokenize(expr) {
        const tokens = [];
        let i = 0;
        while (i < expr.length) {
            const char = expr[i];
            
            if (/\s/.test(char)) {
                i++;
                continue;
            }
            
            if (/[+\-\*\/()]/.test(char)) {
                tokens.push({ type: 'OP', value: char });
                i++;
                continue;
            }
            
            if (char === '{') {
                let j = i + 1;
                while (j < expr.length && expr[j] !== '}') j++;
                tokens.push({ type: 'VAR', value: expr.substring(i, j + 1) });
                i = j + 1;
                continue;
            }
            
            if (/[0-9\.]/.test(char)) {
                let j = i;
                while (j < expr.length && /[0-9\.]/.test(expr[j])) j++;
                tokens.push({ type: 'NUM', value: expr.substring(i, j) });
                i = j;
                continue;
            }
            
            // Handle string literal - 处理字符串字面量
            if (char === "'" || char === '"') {
                 let j = i + 1;
                 while (j < expr.length && expr[j] !== char) j++;
                 tokens.push({ type: 'STR', value: expr.substring(i, j + 1) });
                 i = j + 1;
                 continue;
            }

            i++; // Skip unknown - 跳过未知字符
        }
        return tokens;
    }

    /**
     * Convert tokens from infix notation to Reverse Polish Notation (RPN) using the Shunting Yard algorithm. - 使用分流场算法将标记从中缀表示法转换为逆波兰表示法（RPN）。
     * @param {Array<Object>} tokens - The tokens in infix notation. - 中缀表示法的标记。
     * @returns {Array<Object>} The tokens in RPN. - RPN表示法的标记。
     */
    shuntingYard(tokens) {
        const output = [];
        const stack = [];
        const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
        
        for (const token of tokens) {
            if (token.type === 'NUM' || token.type === 'VAR' || token.type === 'STR') {
                output.push(token);
            } else if (token.type === 'OP') {
                if (token.value === '(') {
                    stack.push(token);
                } else if (token.value === ')') {
                    while (stack.length && stack[stack.length - 1].value !== '(') {
                        output.push(stack.pop());
                    }
                    stack.pop(); // Pop '(' - 弹出左括号
                } else {
                    while (stack.length && 
                           stack[stack.length - 1].value !== '(' && 
                           precedence[stack[stack.length - 1].value] >= precedence[token.value]) {
                        output.push(stack.pop());
                    }
                    stack.push(token);
                }
            }
        }
        while (stack.length) output.push(stack.pop());
        return output;
    }

    /**
     * Evaluate tokens in Reverse Polish Notation (RPN). - 评估逆波兰表示法（RPN）中的标记。
     * @param {Array<Object>} rpn - The tokens in RPN. - RPN表示法的标记。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {DBType} The result of the evaluation. - 评估的结果。
     */
    async evaluateRPN(rpn, context) {
        const stack = [];
        for (const token of rpn) {
            if (token.type === 'NUM') {
                stack.push(new DBNumber(token.value));
            } else if (token.type === 'STR') {
                stack.push(new DBString(token.value.slice(1, -1)));
            } else if (token.type === 'VAR') {
                stack.push(await this.resolveValue(token.value, context));
            } else if (token.type === 'OP') {
                const b = stack.pop();
                const a = stack.pop();
                
                if (!a || !b) throw new Error("Invalid expression");
                
                // Polymorphic operation based on DBType - 基于DBType的多态操作
                switch (token.value) {
                    case '+': stack.push(a.add(b)); break;
                    case '-': stack.push(a.sub(b)); break;
                    case '*': stack.push(a.mul(b)); break;
                    case '/': stack.push(a.div(b)); break;
                }
            }
        }
        return stack[0];
    }
    
    /**
     * Parse a value string into a value using the given context. - 使用给定上下文将值字符串解析为值。
     * @param {string} valStr - The value string to parse. - 要解析的值字符串。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {any} The parsed value. - 解析后的值。
     */
    async parseValue(valStr, context) {
        if (valStr.startsWith('default is ')) {
            return this.resolveValue(valStr.replace('default is ', ''), context);
        }
        return this.resolveValue(valStr, context);
    }

    /**
     * Evaluate a condition string to a boolean value. - 将条件字符串评估为布尔值。
     * @param {string} condition - The condition string to evaluate. - 要评估的条件字符串。
     * @param {Object} context - The execution context. - 执行上下文。
     * @returns {boolean} The result of the condition evaluation. - 条件评估的结果。
     */
    async evaluateCondition(condition, context) {
        // Parse LHS Operator RHS - 解析 LHS 运算符 RHS
        // Support simple "A op B" - 支持简单的 "A op B"
        // Also support natural language - 也支持自然语言
        
        let expr = condition;
        // Normalize operators to simple tokens - 将运算符标准化为简单标记
        expr = expr.replace(/ is equal to /gi, ' == ');
        expr = expr.replace(/ is greater than /gi, ' > ');
        expr = expr.replace(/ is less than /gi, ' < ');
        // ... (add others as needed) - ...（根据需要添加其他）
        
        // Split by operators - 按运算符分割
        // This is a simplification. Ideally, use a full parser. - 这是一个简化。理想情况下，使用完整的解析器。
        // For now, let's assume binary condition: Expr OP Expr - 现在，我们假设二元条件：Expr OP Expr
        
        const ops = ['==', '>', '<', '>=', '<=', '!='];
        let op = null;
        let parts = [];
        
        for (const o of ops) {
            if (expr.includes(` ${o} `)) {
                op = o;
                parts = expr.split(` ${o} `);
                break;
            }
        }
        
        if (op && parts.length === 2) {
            const lhs = await this.resolveValue(parts[0], context);
            const rhs = await this.resolveValue(parts[1], context);
            
            // Normalize values for comparison - 规范化值用于比较
            const lhsVal = lhs instanceof DBType ? lhs : this.wrapValue(lhs);
            const rhsVal = rhs instanceof DBType ? rhs : this.wrapValue(rhs);

            // Special handling for Strings (DBString vs raw string) - 字符串的特殊处理（DBString vs 原始字符串）
            // If one is DBString and other is not (or both), we might need careful comparison - 如果一个是DBString而另一个不是（或两者都是），我们可能需要仔细比较
            // But DBType.eq/gt/lt usually handles wrapping internally via _toDecimal or simple value check. - 但DBType.eq/gt/lt通常通过_toDecimal或简单的值检查在内部处理包装。
            // DBString.eq checks value equality. - DBString.eq检查值相等性。
            
            if (lhsVal instanceof DBType) {
                switch (op) {
                    case '==': return lhsVal.eq(rhsVal);
                    case '>': return lhsVal.gt(rhsVal);
                    case '<': return lhsVal.lt(rhsVal);
                    case '>=': return lhsVal.gte(rhsVal);
                    case '<=': return lhsVal.lte(rhsVal);
                    case '!=': return !lhsVal.eq(rhsVal);
                }
            }
        }
        
        // If simply a boolean variable - 如果只是一个布尔变量
        const val = await this.resolveValue(expr, context);
        if (val instanceof DBBool) return val.value;
        
        return false;
    }
}

module.exports = SqlFunctionParser;

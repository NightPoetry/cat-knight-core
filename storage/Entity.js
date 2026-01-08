const { DBNumber, DBString, DBBool, DBDateTime } = require('./DataTypes');

/**
 * Entity class representing a database entity. - 表示数据库实体的Entity类。
 */
class Entity {
    /**
     * Create a new Entity instance. - 创建一个新的Entity实例。
     * @param {Object} type - The entity definition. - 实体定义。
     * @param {Object} data - The initial data. - 初始数据。
     * @param {boolean} isRef - Whether the data is a reference or a copy. - 数据是引用还是副本。
     * @param {Function|null} loader - The loader function for lazy loading. - 用于延迟加载的加载器函数。
     */
    constructor(type, data = {}, isRef = false, loader = null) {
        this._type = type; // Entity Definition (from .st) - 实体定义（来自.st文件）
        this._data = isRef ? data : {}; // If isRef, bind directly to the data object - 如果是引用，直接绑定到数据对象
        this._isDirty = false;
        this._loader = loader;
        
        if (!isRef) {
            // Initialize fields based on definition (Copy mode) - 基于定义初始化字段（复制模式）
            if (type && type.fields) {
                for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
                    let value = data[fieldName];
                    
                    // Handle Default Values - 处理默认值
                    if (value === undefined && fieldDef.defaultValue !== undefined) {
                        value = this.parseDefaultValue(fieldDef.defaultValue);
                    }
                    
                    // Initial set (will cast to raw storage format) - 初始设置（将转换为原始存储格式）
                    this.set(fieldName, value);
                }
            }
        }
    }

    /**
     * Get the value of a field. - 获取字段的值。
     * @param {string} fieldName - The name of the field to get. - 要获取的字段名称。
     * @returns {any} The field value. - 字段值。
     */
    get(fieldName) {
        // Check if field is relation and not loaded - 检查字段是否为关系且未加载
        // AND check if fieldName is NOT in _data (to avoid overwriting if we manually set it) - 并检查fieldName是否不在_data中（以避免如果我们手动设置它就覆盖）
        // Actually, if it is in _data, we return it. If undefined, we check relations. - 实际上，如果它在_data中，我们返回它。如果未定义，我们检查关系。
        if (this._data[fieldName] === undefined && this._type && this._type.relations) {
            const relation = this._type.relations.find(r => r.field === fieldName);
            if (relation && this._loader) {
                // Check if already loading (promise) or loaded - 检查是否正在加载（Promise）或已加载
                if (this._data[fieldName] instanceof Promise) {
                    return this._data[fieldName];
                }
                
                // Lazy Load - 延迟加载
                // ...Loader should return DBType or Entity or List of Entity - ...加载器应返回DBType或Entity或Entity列表
                // NOTE: _loader is async! We need to handle async in get? - 注意：_loader是异步的！我们需要在get中处理异步？
                // JS getters cannot be async. - JS getter不能是异步的
                // This means 'get' returns a Promise if it hits a loader? - 这意味着如果get命中加载器，它会返回一个Promise？
                // Or we must preload? - 或者我们必须预加载？
                
                // If we are in SqlFunctionParser logic, resolveValue calls get(). - 如果我们在SqlFunctionParser逻辑中，resolveValue调用get()
                // If get() returns a promise, resolveValue must await it. - 如果get()返回一个Promise，resolveValue必须await它
                // Let's make get() return Promise if loading, or value if present. - 让我们让get()在加载时返回Promise，或在存在时返回值
                // But this changes signature. - 但这会改变签名
                
                // Actually, standard lazy loading usually implies the property access triggers a fetch. - 实际上，标准的延迟加载通常意味着属性访问会触发获取
                // In JS, `obj.posts` returning a Promise is annoying. - 在JS中，`obj.posts`返回Promise很烦人
                // But since we control the execution engine (SqlFunctionParser), we can handle it. - 但由于我们控制执行引擎（SqlFunctionParser），我们可以处理它
                
                const promise = this._loader(this, relation).then(res => {
                    // Update internal data with loaded result - 使用加载的结果更新内部数据
                    this._data[fieldName] = (res === undefined) ? null : res;
                    return this._data[fieldName];
                }).catch(err => {
                    delete this._data[fieldName];
                    throw err;
                });
                
                // Cache the promise to avoid repeated loading - 缓存Promise以避免重复加载
                this._data[fieldName] = promise;
                return promise;
            }
        }
        
        // Return wrapped DBType or raw value - 返回包装的DBType或原始值
        // If field is relation and was loaded (is promise or array), return it directly. - 如果字段是关系且已加载（是Promise或数组），直接返回它
        // Or if it is a standard field. - 或者如果它是标准字段
        
        // Check if field is defined in schema as standard field - 检查字段是否在架构中定义为标准字段
        const fieldDef = this._type && this._type.fields && this._type.fields[fieldName];
        if (fieldDef) {
            return this.castToDBType(this._data[fieldName], fieldDef);
        }
        
        // If not standard field (e.g. relation already loaded), return raw - 如果不是标准字段（例如关系已加载），返回原始值
        // If it is a promise (cached loader), return it - 如果它是Promise（缓存的加载器），返回它
        // IMPORTANT: We must NOT wrap a Promise in DBType (it fails castToDBType logic implicitly if we did) - 重要：我们不能将Promise包装在DBType中（如果我们这样做，它会隐式地失败castToDBType逻辑）
        return this._data[fieldName];
    }

    /**
     * Set the value of a field. - 设置字段的值。
     * @param {string} fieldName - The name of the field to set. - 要设置的字段名称。
     * @param {any} value - The value to set. - 要设置的值。
     */
    set(fieldName, value) {
        // Validate against schema - 根据架构验证
        if (this._type && this._type.fields[fieldName]) {
             const fieldDef = this._type.fields[fieldName];
             const dbType = this.castToDBType(value, fieldDef);
             // Store raw value (string for number, etc.) - 存储原始值（数字为字符串等）
             this._data[fieldName] = dbType.getValue();
             this._isDirty = true;
        } else {
             throw new Error(`Field '${fieldName}' not defined in entity '${this._type.name || "Unknown"}'`);
        }
    }

    /**
     * Cast a value to the appropriate DBType based on the field definition. - 根据字段定义将值转换为适当的DBType。
     * @param {any} value - The value to cast. - 要转换的值。
     * @param {Object} fieldDef - The field definition. - 字段定义。
     * @returns {DBType|null} The cast DBType value. - 转换后的DBType值。
     */
    castToDBType(value, fieldDef) {
        if (value === null || value === undefined) return null;
        
        // If already DBType, check if it matches constraints (re-validation) - 如果已经是DBType，检查它是否匹配约束（重新验证）
        if (value instanceof DBNumber || value instanceof DBString || value instanceof DBBool || value instanceof DBDateTime) {
             value = value.getValue(); // Unwrap to re-wrap with correct constraints - 解包以使用正确的约束重新包装
        }

        const rawType = fieldDef.rawType.toLowerCase();
        
        if (rawType.startsWith('number')) {
            // Parse number[P.S] or number - 解析 number[P.S] 或 number
            let precision = null;
            let scale = null;
            const match = rawType.match(/number\[(\d+)(?:\.(\d+))?\]/);
            if (match) {
                precision = parseInt(match[1]);
                scale = match[2] ? parseInt(match[2]) : 0;
            }
            return new DBNumber(value, precision, scale);
        }
        
        if (rawType.startsWith('str')) {
            // Parse str[L] - 解析 str[L]
            let maxLength = null;
            const match = rawType.match(/str\[(\d+)\]/);
            if (match) {
                maxLength = parseInt(match[1]);
            }
            return new DBString(value, maxLength);
        }
        
        if (rawType.startsWith('bool')) {
            // SQLite stores boolean as 1/0, need to convert back - SQLite将布尔值存储为1/0，需要转换回来
            if (value === 1) return new DBBool(true);
            if (value === 0) return new DBBool(false);
            return new DBBool(value);
        }
        
        if (rawType.startsWith('datetime')) {
            return new DBDateTime(value);
        }

        return value;
    }

    /**
     * Parse a default value string into a value. - 将默认值字符串解析为值。
     * @param {string} valStr - The default value string. - 默认值字符串。
     * @returns {any} The parsed default value. - 解析后的默认值。
     */
    parseDefaultValue(valStr) {
        // ... (existing implementation)
        if (!valStr) return null;
        if (valStr === 'true') return true;
        if (valStr === 'false') return false;
        if (valStr.startsWith("'") || valStr.startsWith('"')) return valStr.slice(1, -1);
        if (!isNaN(valStr)) return valStr; // Keep as string for number default - 数字默认值保持为字符串
        if (valStr === 'CURRENT_TIMESTAMP' || valStr === 'datetime.now()') return new Date();
        return valStr;
    }

    /**
     * Convert the Entity to JSON for serialization. - 将Entity转换为JSON以进行序列化。
     * @returns {Object} The JSON representation. - JSON表示。
     */
    async toJSON() {
        // Deep conversion for serialization (return to user) - 用于序列化的深度转换（返回给用户）
        const output = {};
        
        // Serialize simple fields - 序列化简单字段
        if (this._type && this._type.fields) {
            for (const key of Object.keys(this._type.fields)) {
                const val = this._data[key];
                // Handle potential DBTypes or raw values - 处理潜在的DBTypes或原始值
                if (val && typeof val.getValue === 'function') {
                    output[key] = val.getValue();
                } else {
                    output[key] = val;
                }
            }
        }
        
        // Serialize loaded relations (and other dynamic props) - 序列化已加载的关系（和其他动态属性）
        for (const [key, val] of Object.entries(this._data)) {
            // Skip fields already handled - 跳过已处理的字段
            if (this._type && this._type.fields && this._type.fields[key]) continue;
            
            // Handle Relations - 处理关系
            let resolvedVal = val;
            if (val instanceof Promise) {
                // Wait for lazy load to finish if it was triggered but not resolved? - 如果延迟加载已触发但未解决，是否等待它完成？
                // Or should we ignore pending promises? - 或者我们应该忽略挂起的Promise？
                // Usually toJSON is called at end of request. - 通常在请求结束时调用toJSON。
                // If we want to include loaded data, we should await. - 如果我们想包含已加载的数据，我们应该await。
                resolvedVal = await val;
            }

            if (Array.isArray(resolvedVal)) {
                // Use Promise.all for array of entities - 对实体数组使用Promise.all
                output[key] = await Promise.all(resolvedVal.map(async item => item instanceof Entity ? await item.toJSON() : item));
            } else if (resolvedVal instanceof Entity) {
                output[key] = await resolvedVal.toJSON();
            } else {
                output[key] = resolvedVal;
            }
        }
        
        return output;
    }
}

module.exports = Entity;

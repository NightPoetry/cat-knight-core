const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');
const { DBNumber, DBString, DBBool, DBDateTime } = require('../DataTypes');

class SQLiteAdapter {
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.db = null;
        // Options: 
        // isolationLevel: 'SERIALIZABLE' | 'READ_UNCOMMITTED' | 'READ_COMMITTED' (Default: SERIALIZABLE)
        this.options = Object.assign({
            isolationLevel: 'SERIALIZABLE'
        }, options);
    }

    async init() {
        // Ensure directory exists
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
        
        // Enable foreign keys
        await this.db.run('PRAGMA foreign_keys = ON');

        // Configure Isolation Level
        if (this.options.isolationLevel === 'SERIALIZABLE') {
            // Strict Serializable:
            // 1. read_uncommitted = false (Default)
            // 2. Use BEGIN EXCLUSIVE for write transactions to prevent concurrency issues
            await this.db.run('PRAGMA read_uncommitted = false');
        } else if (this.options.isolationLevel === 'READ_UNCOMMITTED') {
            await this.db.run('PRAGMA read_uncommitted = true');
        }
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }

    // --- Schema Management ---

    async ensureTable(entityName, entityDef) {
        // Map types to SQLite
        const columns = [];
        const primaryKeys = [];

        // Quote Entity Name to prevent keyword conflict/injection
        const quotedEntityName = `"${entityName.replace(/"/g, '""')}"`;

        for (const [fieldName, fieldDef] of Object.entries(entityDef.fields)) {
            let sqlType = 'TEXT'; // Default to TEXT for precision safety (DBNumber)
            let constraints = [];

            const rawType = fieldDef.rawType.toLowerCase();

            if (rawType.startsWith('number')) {
                sqlType = 'TEXT'; // Store precise numbers as strings
            } else if (rawType.startsWith('bool')) {
                sqlType = 'INTEGER'; // 0 or 1
            } else if (rawType.startsWith('datetime')) {
                sqlType = 'TEXT'; // ISO string
            }

            if (rawType.includes('[primary]')) {
                primaryKeys.push(`"${fieldName}"`);
            }
            if (rawType.includes('[not null]')) {
                constraints.push('NOT NULL');
            }
            if (rawType.includes('[unique]')) {
                constraints.push('UNIQUE');
            }

            // Quote Field Name
            columns.push(`"${fieldName}" ${sqlType} ${constraints.join(' ')}`);
        }

        // Handle Primary Key
        if (primaryKeys.length > 0) {
            columns.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
        }

        const createSql = `CREATE TABLE IF NOT EXISTS ${quotedEntityName} (${columns.join(', ')});`;
        await this.db.exec(createSql);
    }

    async ensureRelationTable(entity1, entity2, pk1, pk2) {
        // Sort entities to ensure consistent table name (e.g., "Tag_User" vs "User_Tag")
        // But table name should be snake_case. 
        // Let's use lowercase for comparison and naming.
        const [e1, e2] = [entity1, entity2].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        
        // Map original entities to sorted PKs
        // If e1 is entity1, use pk1. If e1 is entity2, use pk2.
        const k1 = (e1 === entity1) ? pk1 : pk2;
        const k2 = (e2 === entity2) ? pk2 : pk1;

        const tableName = `"${e1.toLowerCase()}_${e2.toLowerCase()}"`;
        const col1 = `"${e1.toLowerCase()}_${k1}"`;
        const col2 = `"${e2.toLowerCase()}_${k2}"`;

        // Create Table SQL
        // Note: Relation table uses simple TEXT for IDs (matching stored DBTypes)
        // Composite Primary Key
        const sql = `
            CREATE TABLE IF NOT EXISTS ${tableName} (
                ${col1} TEXT NOT NULL,
                ${col2} TEXT NOT NULL,
                "create_time" TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (${col1}, ${col2}),
                FOREIGN KEY (${col1}) REFERENCES "${e1}"("${k1}") ON DELETE CASCADE,
                FOREIGN KEY (${col2}) REFERENCES "${e2}"("${k2}") ON DELETE CASCADE
            );
        `;
        
        // console.log(`[Adapter] Creating Relation Table: ${tableName}`, sql);
        await this.db.exec(sql);
        
        // Create Indices for performance
        await this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${e1.toLowerCase()}_${e2.toLowerCase()}_1" ON ${tableName} (${col1});`);
        await this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${e1.toLowerCase()}_${e2.toLowerCase()}_2" ON ${tableName} (${col2});`);
    }

    async ensureOrphanTrigger(targetEntity, targetPk, triggerTable, targetIdCol, allRelationChecks) {
        // triggerTable: The table being deleted from (e.g., class_student)
        // targetEntity: Student
        // targetIdCol: student_id (in triggerTable)
        // allRelationChecks: Array of { table: 'other_rel', col: 'student_id' }
        
        // Trigger Name: auto_gc_{target}_{triggerTable}
        const triggerName = `auto_gc_${targetEntity.toLowerCase()}_from_${triggerTable.replace(/"/g, '')}`;
        
        // Build NOT EXISTS checks
        // AND NOT EXISTS (SELECT 1 FROM table WHERE col = OLD.targetIdCol)
        const checks = allRelationChecks.map(check => {
            return `AND NOT EXISTS (SELECT 1 FROM ${check.table} WHERE ${check.col} = OLD.${targetIdCol})`;
        }).join('\n            ');

        const sql = `
            CREATE TRIGGER IF NOT EXISTS ${triggerName}
            AFTER DELETE ON ${triggerTable}
            BEGIN
                DELETE FROM "${targetEntity}"
                WHERE "${targetPk}" = OLD.${targetIdCol}
                ${checks};
            END;
        `;
        
        // console.log(`[Adapter] Creating GC Trigger: ${triggerName}`, sql);
        await this.db.exec(sql);
    }

    // --- Data Operations ---

    async findOne(entityName, criteria) {
        const { where, params } = this._buildWhere(criteria);
        // Quote entity name
        const sql = `SELECT * FROM "${entityName}" WHERE ${where} LIMIT 1`;
        const row = await this.db.get(sql, params);
        return row; 
    }

    async find(entityName, criteria) {
        const { where, params } = this._buildWhere(criteria);
        // Quote entity name
        const sql = `SELECT * FROM "${entityName}" WHERE ${where}`;
        const rows = await this.db.all(sql, params);
        return rows;
    }

    async insert(entityName, data) {
        const keys = Object.keys(data);
        const values = Object.values(data).map(v => this._serialize(v));
        const placeholders = keys.map(() => '?').join(', ');
        
        const sql = `INSERT INTO "${entityName}" (${keys.join(', ')}) VALUES (${placeholders})`;
        await this.db.run(sql, values);
    }

    async update(entityName, pkCriteria, updates) {
        const { where, params: whereParams } = this._buildWhere(pkCriteria);
        
        const updateKeys = Object.keys(updates);
        const updateValues = Object.values(updates).map(v => this._serialize(v));
        const setClause = updateKeys.map(k => `${k} = ?`).join(', ');
        
        const sql = `UPDATE "${entityName}" SET ${setClause} WHERE ${where}`;
        await this.db.run(sql, [...updateValues, ...whereParams]);
    }

    // --- Transaction Management ---

    async beginTransaction() {
        if (this.options.isolationLevel === 'SERIALIZABLE') {
            // EXCLUSIVE prevents other connections from reading or writing
            await this.db.run('BEGIN EXCLUSIVE TRANSACTION');
        } else {
            // IMMEDIATE prevents other writers, DEFERRED (default) allows readers until first write
            await this.db.run('BEGIN IMMEDIATE TRANSACTION');
        }
    }

    async commit() {
        await this.db.run('COMMIT');
    }

    async rollback() {
        await this.db.run('ROLLBACK');
    }

    // --- Helpers ---

    _buildWhere(criteria) {
        const clauses = [];
        const params = [];
        for (const [key, value] of Object.entries(criteria)) {
            clauses.push(`${key} = ?`);
            params.push(this._serialize(value));
        }
        return {
            where: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
            params
        };
    }

    _serialize(value) {
        if (value instanceof DBNumber || value instanceof DBString || value instanceof DBBool || value instanceof DBDateTime) {
            value = value.getValue();
        }
        
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    }
}

module.exports = SQLiteAdapter;

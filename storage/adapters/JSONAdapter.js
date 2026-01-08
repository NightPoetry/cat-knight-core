const fs = require('fs');
const path = require('path');
const { DBType, DBNumber, DBString, DBBool, DBDateTime } = require('../DataTypes');

class JSONAdapter {
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.data = {}; // In-memory data cache
        this.schemas = {}; // Table schemas
        this.isInTransaction = false;
        this.transactionSnapshot = null;
        this.options = Object.assign({
            isolationLevel: 'SERIALIZABLE'
        }, options);
        this._ensureDirectory();
    }

    async init() {
        // Load data from JSON file if it exists
        if (fs.existsSync(this.dbPath)) {
            const content = fs.readFileSync(this.dbPath, 'utf8');
            const parsed = JSON.parse(content);
            this.data = parsed.data || {};
            this.schemas = parsed.schemas || {};
        }
    }

    async close() {
        // Ensure all data is saved
        this._save();
    }

    // --- Schema Management ---

    async ensureTable(entityName, entityDef) {
        // Create table in memory if it doesn't exist
        if (!this.data[entityName]) {
            this.data[entityName] = [];
        }

        // Store schema for validation
        this.schemas[entityName] = entityDef;
        this._save();
    }

    async ensureRelationTable(entity1, entity2, pk1, pk2) {
        // Same logic as SQLiteAdapter to get consistent table name
        const [e1, e2] = [entity1, entity2].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        const k1 = (e1 === entity1) ? pk1 : pk2;
        const k2 = (e2 === entity2) ? pk2 : pk1;

        const tableName = `${e1.toLowerCase()}_${e2.toLowerCase()}`;
        
        // Create relation table if it doesn't exist
        if (!this.data[tableName]) {
            this.data[tableName] = [];
        }

        // Simple schema for relation table
        this.schemas[tableName] = {
            fields: {
                [k1]: { rawType: 'string [primary]' },
                [k2]: { rawType: 'string [primary]' },
                create_time: { rawType: 'datetime' }
            }
        };
        
        this._save();
    }

    async ensureOrphanTrigger(targetEntity, targetPk, triggerTable, targetIdCol, allRelationChecks) {
        // JSON adapter doesn't support triggers
        // This is a no-op for JSON adapter since we don't have database triggers
        // Orphan cleanup would need to be handled application-side
    }

    // --- Data Operations ---

    async findOne(entityName, criteria) {
        const entities = this.data[entityName] || [];
        const matched = entities.find(entity => this._matchesCriteria(entity, criteria));
        return matched ? this._deserialize(matched, entityName) : null;
    }

    async find(entityName, criteria) {
        const entities = this.data[entityName] || [];
        const matched = entities.filter(entity => this._matchesCriteria(entity, criteria));
        return matched.map(entity => this._deserialize(entity, entityName));
    }

    async insert(entityName, data) {
        // Validate data against schema
        this._validateData(entityName, data);
        
        // Check unique constraints
        this._checkUniqueConstraints(entityName, data);
        
        // Serialize data
        const serialized = this._serialize(data, entityName);
        
        // Insert into data
        if (!this.data[entityName]) {
            this.data[entityName] = [];
        }
        
        this.data[entityName].push(serialized);
        
        if (!this.isInTransaction) {
            this._save();
        }
    }

    async update(entityName, pkCriteria, updates) {
        // Validate updates against schema
        this._validateData(entityName, updates, true);
        
        // Check unique constraints for updated fields
        this._checkUniqueConstraints(entityName, updates, pkCriteria);
        
        // Serialize updates
        const serializedUpdates = this._serialize(updates, entityName);
        
        // Find and update matching entities
        const entities = this.data[entityName] || [];
        let updated = false;
        
        for (let i = 0; i < entities.length; i++) {
            if (this._matchesCriteria(entities[i], pkCriteria)) {
                entities[i] = { ...entities[i], ...serializedUpdates };
                updated = true;
                // Only update one entity for now (like SQLiteAdapter)
                break;
            }
        }
        
        if (!this.isInTransaction) {
            this._save();
        }
        
        return updated;
    }

    // --- Transaction Management ---

    async beginTransaction() {
        if (this.isInTransaction) {
            throw new Error('Transaction already in progress');
        }
        
        // Create snapshot of current data
        this.transactionSnapshot = {
            data: JSON.parse(JSON.stringify(this.data)),
            schemas: JSON.parse(JSON.stringify(this.schemas))
        };
        
        this.isInTransaction = true;
    }

    async commit() {
        if (!this.isInTransaction) {
            throw new Error('No transaction in progress');
        }
        
        // Save changes to disk
        this._save();
        
        // Clear transaction state
        this.transactionSnapshot = null;
        this.isInTransaction = false;
    }

    async rollback() {
        if (!this.isInTransaction) {
            throw new Error('No transaction in progress');
        }
        
        // Restore from snapshot
        this.data = this.transactionSnapshot.data;
        this.schemas = this.transactionSnapshot.schemas;
        
        // Clear transaction state
        this.transactionSnapshot = null;
        this.isInTransaction = false;
    }

    // --- Helper Methods ---

    _ensureDirectory() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    _save() {
        // Save data to JSON file
        const content = JSON.stringify({ data: this.data, schemas: this.schemas }, null, 2);
        fs.writeFileSync(this.dbPath, content, 'utf8');
    }

    _matchesCriteria(entity, criteria) {
        for (const [key, value] of Object.entries(criteria)) {
            const entityValue = entity[key];
            const searchValue = value instanceof DBType ? value.getValue() : value;
            
            if (entityValue !== searchValue) {
                return false;
            }
        }
        return true;
    }

    _validateData(entityName, data, isUpdate = false) {
        const schema = this.schemas[entityName];
        if (!schema) {
            throw new Error(`Table ${entityName} not found`);
        }

        for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
            const rawType = fieldDef.rawType.toLowerCase();
            const value = data[fieldName];
            
            // Skip validation for update if field not provided
            if (isUpdate && value === undefined) {
                continue;
            }

            // Check not null constraint
            if (rawType.includes('[not null]') && (value === null || value === undefined)) {
                throw new Error(`Field ${fieldName} cannot be null`);
            }

            // Skip validation if value is null/undefined and not required
            if (value === null || value === undefined) {
                continue;
            }

            // Validate data type
            if (rawType.startsWith('number')) {
                if (!(value instanceof DBNumber)) {
                    throw new Error(`Field ${fieldName} must be a DBNumber instance`);
                }
            } else if (rawType.startsWith('string')) {
                if (!(value instanceof DBString)) {
                    throw new Error(`Field ${fieldName} must be a DBString instance`);
                }
            } else if (rawType.startsWith('bool')) {
                if (!(value instanceof DBBool)) {
                    throw new Error(`Field ${fieldName} must be a DBBool instance`);
                }
            } else if (rawType.startsWith('datetime')) {
                if (!(value instanceof DBDateTime)) {
                    throw new Error(`Field ${fieldName} must be a DBDateTime instance`);
                }
            }
        }
    }

    _checkUniqueConstraints(entityName, data, pkCriteria = null) {
        const schema = this.schemas[entityName];
        if (!schema) {
            throw new Error(`Table ${entityName} not found`);
        }

        for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
            const rawType = fieldDef.rawType.toLowerCase();
            const value = data[fieldName];
            
            // Only check unique constraints if field is being updated/inserted
            if (value === undefined) {
                continue;
            }

            if (rawType.includes('[unique]')) {
                const entities = this.data[entityName] || [];
                const uniqueValue = value.getValue();
                
                for (const entity of entities) {
                    // Skip the entity being updated (identified by pkCriteria)
                    if (pkCriteria && this._matchesCriteria(entity, pkCriteria)) {
                        continue;
                    }
                    
                    if (entity[fieldName] === uniqueValue) {
                        throw new Error(`Unique constraint violation on ${fieldName}: ${uniqueValue}`);
                    }
                }
            }
        }
    }

    _serialize(data, entityName) {
        const serialized = {};
        
        for (const [key, value] of Object.entries(data)) {
            if (value instanceof DBNumber || value instanceof DBString || value instanceof DBBool || value instanceof DBDateTime) {
                serialized[key] = value.getValue();
            } else {
                serialized[key] = value;
            }
        }
        
        return serialized;
    }

    _deserialize(data, entityName) {
        const deserialized = {};
        const schema = this.schemas[entityName];
        
        for (const [key, value] of Object.entries(data)) {
            if (schema && schema.fields[key]) {
                const rawType = schema.fields[key].rawType.toLowerCase();
                
                if (rawType.startsWith('number')) {
                    // Extract precision and scale from rawType
                    const precisionScaleMatch = rawType.match(/number\((\d+),(\d+)\)/);
                    const precision = precisionScaleMatch ? parseInt(precisionScaleMatch[1]) : null;
                    const scale = precisionScaleMatch ? parseInt(precisionScaleMatch[2]) : null;
                    deserialized[key] = new DBNumber(value, precision, scale);
                } else if (rawType.startsWith('string')) {
                    // Extract maxLength from rawType
                    const maxLengthMatch = rawType.match(/string\((\d+)\)/);
                    const maxLength = maxLengthMatch ? parseInt(maxLengthMatch[1]) : null;
                    deserialized[key] = new DBString(value, maxLength);
                } else if (rawType.startsWith('bool')) {
                    deserialized[key] = new DBBool(value);
                } else if (rawType.startsWith('datetime')) {
                    deserialized[key] = new DBDateTime(value);
                } else {
                    deserialized[key] = value;
                }
            } else {
                deserialized[key] = value;
            }
        }
        
        return deserialized;
    }
}

module.exports = JSONAdapter;
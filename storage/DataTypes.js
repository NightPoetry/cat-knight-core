const Decimal = require('decimal.js');

/**
 * Base class for all database types. - 所有数据库类型的基类。
 */
class DBType {
    /**
     * Create a new DBType instance. - 创建一个新的DBType实例。
     * @param {any} value - The underlying value. - 底层值。
     */
    constructor(value) {
        this.value = value;
    }

    /**
     * Convert the DBType to a string. - 将DBType转换为字符串。
     * @returns {string} The string representation. - 字符串表示。
     */
    toString() {
        return String(this.value);
    }

    /**
     * Convert the DBType to JSON. - 将DBType转换为JSON。
     * @returns {any} The JSON representation. - JSON表示。
     */
    toJSON() {
        return this.value;
    }
    
    /**
     * Get the underlying value. - 获取底层值。
     * @returns {any} The underlying value. - 底层值。
     */
    getValue() {
        return this.value;
    }
}

/**
 * Database number type with precision and scale support. - 支持精度和小数位数的数据库数字类型。
 * @extends DBType
 */
class DBNumber extends DBType {
    /**
     * Create a new DBNumber instance. - 创建一个新的DBNumber实例。
     * @param {number|string|Decimal} value - The value to store. - 要存储的值。
     * @param {number|null} precision - The total number of digits. - 总位数。
     * @param {number|null} scale - The number of decimal places. - 小数位数。
     */
    constructor(value, precision = null, scale = null) {
        // value can be number, string, or Decimal - value可以是数字、字符串或Decimal
        super(new Decimal(value));
        this.precision = precision;
        this.scale = scale;
        this.validate();
    }

    /**
     * Validate the number against precision and scale constraints. - 根据精度和小数位数约束验证数字。
     */
    validate() {
        if (this.scale !== null) {
            // Check decimal places - 检查小数位数
            const dp = this.value.decimalPlaces();
            if (dp > this.scale) {
                 // Strict validation: Throw error instead of implicit rounding - 严格验证：抛出错误而不是隐式四舍五入
                 throw new Error(`Value ${this.value} exceeds scale ${this.scale}. Use .round(${this.scale}) explicitly if needed.`);
            }
        }
        
        if (this.precision !== null) {
            // Check total digits (integer digits + scale) - 检查总位数（整数位数 + 小数位数）
            // Max value = 10^(precision - scale) - 10^(-scale) - 最大值 = 10^(precision - scale) - 10^(-scale)
            const maxVal = new Decimal(10).pow((this.precision - (this.scale || 0))).minus(new Decimal(1).div(new Decimal(10).pow(this.scale || 0)));
            
            if (this.value.abs().gt(maxVal)) {
                 throw new Error(`Value ${this.value} exceeds precision ${this.precision}, scale ${this.scale}`);
            }
        }
    }

    /**
     * Get the underlying value as a string to preserve precision. - 获取底层值作为字符串以保持精度。
     * @returns {string} The string representation of the number. - 数字的字符串表示。
     */
    getValue() {
        // Return string to preserve precision as requested - 返回字符串以保持请求的精度
        // If scale is set, ensure trailing zeros - 如果设置了scale，确保尾部有零
        if (this.scale !== null) {
            return this.value.toFixed(this.scale);
        }
        return this.value.toString();
    }

    /**
     * Add another value to this DBNumber. - 将另一个值添加到此DBNumber。
     * @param {any} other - The value to add. - 要添加的值。
     * @returns {DBNumber} The sum as a new DBNumber. - 和作为新的DBNumber。
     */
    add(other) {
        return new DBNumber(this.value.plus(this._toDecimal(other)), this.precision, this.scale);
    }

    /**
     * Subtract another value from this DBNumber. - 从此DBNumber减去另一个值。
     * @param {any} other - The value to subtract. - 要减去的值。
     * @returns {DBNumber} The difference as a new DBNumber. - 差作为新的DBNumber。
     */
    sub(other) {
        return new DBNumber(this.value.minus(this._toDecimal(other)), this.precision, this.scale);
    }

    /**
     * Multiply this DBNumber by another value. - 将此DBNumber乘以另一个值。
     * @param {any} other - The value to multiply by. - 要乘以的值。
     * @returns {DBNumber} The product as a new DBNumber. - 积作为新的DBNumber。
     */
    mul(other) {
        return new DBNumber(this.value.times(this._toDecimal(other)), this.precision, this.scale);
    }

    /**
     * Divide this DBNumber by another value. - 将此DBNumber除以另一个值。
     * @param {any} other - The value to divide by. - 要除以的值。
     * @returns {DBNumber} The quotient as a new DBNumber. - 商作为新的DBNumber。
     */
    div(other) {
        return new DBNumber(this.value.div(this._toDecimal(other)), this.precision, this.scale);
    }

    /**
     * Check if this DBNumber is equal to another value. - 检查此DBNumber是否等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if equal, false otherwise. - 如果相等则为true，否则为false。
     */
    eq(other) {
        return this.value.equals(this._toDecimal(other));
    }

    /**
     * Check if this DBNumber is greater than another value. - 检查此DBNumber是否大于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if greater than, false otherwise. - 如果大于则为true，否则为false。
     */
    gt(other) {
        return this.value.greaterThan(this._toDecimal(other));
    }
    
    /**
     * Check if this DBNumber is greater than or equal to another value. - 检查此DBNumber是否大于或等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if greater than or equal, false otherwise. - 如果大于或等于则为true，否则为false。
     */
    gte(other) {
        return this.value.greaterThanOrEqualTo(this._toDecimal(other));
    }

    /**
     * Check if this DBNumber is less than another value. - 检查此DBNumber是否小于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if less than, false otherwise. - 如果小于则为true，否则为false。
     */
    lt(other) {
        return this.value.lessThan(this._toDecimal(other));
    }
    
    /**
     * Check if this DBNumber is less than or equal to another value. - 检查此DBNumber是否小于或等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if less than or equal, false otherwise. - 如果小于或等于则为true，否则为false。
     */
    lte(other) {
        return this.value.lessThanOrEqualTo(this._toDecimal(other));
    }

    /**
     * Convert another value to a Decimal. - 将另一个值转换为Decimal。
     * @param {any} other - The value to convert. - 要转换的值。
     * @returns {Decimal} The converted Decimal value. - 转换后的Decimal值。
     * @private
     */
    _toDecimal(other) {
        if (other instanceof DBNumber) {
            return other.value;
        }
        return new Decimal(other);
    }
    
    /**
     * Round this DBNumber to the specified decimal places. - 将此DBNumber四舍五入到指定的小数位数。
     * @param {number} dp - The number of decimal places. - 小数位数。
     * @param {number} roundingMode - The rounding mode to use. - 要使用的四舍五入模式。
     * @returns {DBNumber} A new DBNumber with the rounded value. - 具有四舍五入值的新DBNumber。
     */
    round(dp = 0, roundingMode = Decimal.ROUND_HALF_UP) {
        // Explicit rounding method returning new DBNumber - 显式四舍五入方法返回新的DBNumber
        const newValue = this.value.toDecimalPlaces(dp, roundingMode);
        // We create new DBNumber with same precision/scale constraints - 我们使用相同的precision/scale约束创建新的DBNumber
        // This allows user to explicitly fix precision before passing to strict contexts - 这允许用户在传递到严格上下文之前显式修复精度
        return new DBNumber(newValue, this.precision, this.scale);
    }
}

/**
 * Database string type with max length support. - 支持最大长度的数据库字符串类型。
 * @extends DBType
 */
class DBString extends DBType {
    /**
     * Create a new DBString instance. - 创建一个新的DBString实例。
     * @param {any} value - The value to store. - 要存储的值。
     * @param {number|null} maxLength - The maximum length of the string. - 字符串的最大长度。
     */
    constructor(value, maxLength = null) {
        super(String(value));
        this.maxLength = maxLength;
        this.validate();
    }
    
    /**
     * Validate the string against max length constraint. - 根据最大长度约束验证字符串。
     */
    validate() {
        if (this.maxLength !== null && this.value.length > this.maxLength) {
            throw new Error(`String length ${this.value.length} exceeds max length ${this.maxLength}`);
        }
    }
    
    /**
     * Concatenate another value to this DBString. - 将另一个值连接到此DBString。
     * @param {any} other - The value to concatenate. - 要连接的值。
     * @returns {DBString} The concatenated string as a new DBString. - 连接后的字符串作为新的DBString。
     */
    add(other) {
        // String concatenation - 字符串连接
        return new DBString(this.value + String(other));
    }
    
    /**
     * Check if this DBString is equal to another value. - 检查此DBString是否等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if equal, false otherwise. - 如果相等则为true，否则为false。
     */
    eq(other) {
        return this.value === String(other instanceof DBType ? other.getValue() : other);
    }
}

/**
 * Database boolean type. - 数据库布尔类型。
 * @extends DBType
 */
class DBBool extends DBType {
    /**
     * Create a new DBBool instance. - 创建一个新的DBBool实例。
     * @param {any} value - The value to store. - 要存储的值。
     */
    constructor(value) {
        super(Boolean(value));
    }
    
    /**
     * Check if this DBBool is equal to another value. - 检查此DBBool是否等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if equal, false otherwise. - 如果相等则为true，否则为false。
     */
    eq(other) {
        return this.value === Boolean(other instanceof DBType ? other.getValue() : other);
    }
    
    /**
     * Get the negation of this DBBool. - 获取此DBBool的否定。
     * @returns {DBBool} A new DBBool with the negated value. - 具有否定值的新DBBool。
     */
    not() {
        return new DBBool(!this.value);
    }
    
    /**
     * Perform logical AND with another value. - 与另一个值执行逻辑AND。
     * @param {any} other - The value to AND with. - 要AND的值。
     * @returns {DBBool} A new DBBool with the result. - 具有结果的新DBBool。
     */
    and(other) {
        return new DBBool(this.value && (other instanceof DBType ? other.getValue() : other));
    }
    
    /**
     * Perform logical OR with another value. - 与另一个值执行逻辑OR。
     * @param {any} other - The value to OR with. - 要OR的值。
     * @returns {DBBool} A new DBBool with the result. - 具有结果的新DBBool。
     */
    or(other) {
        return new DBBool(this.value || (other instanceof DBType ? other.getValue() : other));
    }
}

/**
 * Database datetime type. - 数据库日期时间类型。
 * @extends DBType
 */
class DBDateTime extends DBType {
    /**
     * Create a new DBDateTime instance. - 创建一个新的DBDateTime实例。
     * @param {any} value - The value to store. - 要存储的值。
     */
    constructor(value) {
        super(new Date(value));
    }
    
    /**
     * Get the underlying Date object. - 获取底层Date对象。
     * @returns {Date} The Date object. - Date对象。
     */
    getValue() {
        return this.value; // Return Date object
    }
    
    /**
     * Check if this DBDateTime is equal to another value. - 检查此DBDateTime是否等于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if equal, false otherwise. - 如果相等则为true，否则为false。
     */
    eq(other) {
        const otherVal = other instanceof DBType ? other.getValue() : new Date(other);
        return this.value.getTime() === otherVal.getTime();
    }
    
    /**
     * Check if this DBDateTime is greater than another value. - 检查此DBDateTime是否大于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if greater than, false otherwise. - 如果大于则为true，否则为false。
     */
    gt(other) {
        const otherVal = other instanceof DBType ? other.getValue() : new Date(other);
        return this.value.getTime() > otherVal.getTime();
    }
    
    /**
     * Check if this DBDateTime is less than another value. - 检查此DBDateTime是否小于另一个值。
     * @param {any} other - The value to compare with. - 要比较的值。
     * @returns {boolean} True if less than, false otherwise. - 如果小于则为true，否则为false。
     */
    lt(other) {
        const otherVal = other instanceof DBType ? other.getValue() : new Date(other);
        return this.value.getTime() < otherVal.getTime();
    }
}

module.exports = {
    DBType,
    DBNumber,
    DBString,
    DBBool,
    DBDateTime
};

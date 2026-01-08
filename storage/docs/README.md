# Storage Core 模块设计与使用文档 v1.2

## 1. 设计理念

Storage Core 是一个轻量级、领域特定语言 (DSL) 驱动的持久化层框架。它的核心目标是将**业务逻辑描述**与**底层存储实现**彻底分离。

*   **声明式定义**：通过 `.st` (Structure) 和 `.dtf` (Transaction Function) 文件描述数据结构和业务流程。
*   **强类型保障**：在应用层实现严格的类型检查，确保跨数据库行为一致性。
*   **生命周期管理**：内置基于**引用计数**和**触发器**的垃圾回收机制 (Orphan Removal)，支持自动清理孤立数据。
*   **事务原子性**：自动将业务逻辑块包裹在 ACID 事务中。
*   **依赖注入架构**：解析器与适配器解耦，支持灵活切换底层存储引擎。

---

## 2. 模块结构与职责

### 2.1 核心组件

#### 1. `DataTypes.js` (类型系统)
定义系统支持的数据类型 (`DBNumber`, `DBString`, `DBBool`, `DBDateTime`)，提供精度控制和运算能力。

#### 2. `Entity.js` (实体封装)
内存中的数据对象包装器，支持：
*   **类型转换**：原始数据与 `DBType` 的互转。
*   **懒加载 (Lazy Loading)**：访问 `List[...]` 属性时按需加载关联数据。

#### 3. `SqlFunctionParser.js` (解析与执行引擎)
系统的“大脑”，负责：
*   解析 DSL 脚本为 AST。
*   识别实体间的依赖关系（Owner），指导适配器生成触发器。
*   执行业务逻辑，自动管理事务。

#### 4. `adapters/SQLiteAdapter.js` (存储适配器)
具体的数据库交互实现层。
*   **Strict Serializable**：默认开启最严格的事务隔离。
*   **自动触发器**：根据 Schema 定义自动生成 `AFTER DELETE` 触发器，实现孤儿数据清理。

---

## 3. 使用指南

### 3.1 语法速查

#### 实体定义与生命周期 (.st)

**1. 独立实体 (Entry Entity)**
拥有独立生命周期，除非显式删除，否则永久存在。
*   **语法**：`EntityName { ... }` (无括号后缀即为独立实体)
*   **示例**：
    ```text
    User {
        number:id [primary]
        str[50]:name
    }
    ```

**2. 从属实体 (Owned Entity)**
依附于一个或多个“所有者”实体。当所有关联的所有者都删除对该实体的引用（即在 N-N 关系表中解除关联）时，该实体会自动被数据库删除（孤儿清理）。
*   **语法**：`EntityName (Owner1, Owner2) { ... }`
*   **示例**：
    ```text
    # 标签依附于文章和用户。
    # 如果一个标签不再属于任何文章，也不属于任何用户，它将自动消失。
    Tag (Post, User) {
        number:id [primary]
        str[20]:name
    }
    ```

#### 关系定义
所有列表类型的字段 `List[Target]` 均通过中间表（N-N 模式）实现，即使是逻辑上的 1-N 关系。
*   **中间表命名**：`entity_target` (按字母序排列)。
*   **懒加载**：访问 `user.posts` 时自动查询中间表。

### 3.2 快速示例

```javascript
const source = `
    Class {
        number:id [primary]
        str:name
        List[Student]:students
    }

    # 学生依附于班级。如果没有班级引用这个学生，学生记录自动删除。
    Student (Class) {
        number:id [primary]
        str:name
    }

    RemoveStudent(number:classId, number:studentId):
        # 仅仅从关系表中移除关联
        # 触发器会自动检查 Student 是否变成孤儿并清理
        Run SQL "DELETE FROM class_student WHERE class_id = {classId} AND student_id = {studentId}"
        return true

    CalculateTotal(number:cartId):
        Get a Cart by id of {cartId} as cart
        Set {total} = 0
        For Each item in {cart.items}:
            Set {total} = {total} + {item.price}
        return {total}
`;
```

## 4. 最佳实践

1.  **生命周期规划**：明确哪些数据是“根”(Entry)，哪些是“叶”(Owned)。过度使用独立实体会导致数据库充斥无用的僵尸数据。
2.  **严格模式**：利用 `DBNumber` 的精度定义防止浮点数计算误差。
3.  **懒加载意识**：在 DSL 中只返回必要的数据字段，避免返回整个包含复杂关系的实体对象，以减少不必要的数据库查询。

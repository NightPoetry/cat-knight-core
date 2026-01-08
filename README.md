# cat-knight-core

Core functionality for Legend of Cat Knight game, including router and storage systems.

## 项目介绍

`cat-knight-core` 是 "猫骑士传奇" 游戏的驱动内核，提供了游戏所需的核心功能模块。

## 核心功能

### 1. 路由系统 (Router)
- **单文件解析**：直接加载单个路由文件，无需复杂的目录结构
- **安全级别**：支持 `private`、`public`、`protected` 三个安全级别
- **外部工具注入**：允许外部传入工具字典，在路由中使用
- **自动包装 async**：所有路由处理函数自动包装为 async
- **生命周期函数支持**：支持 `before`、`after`、`onRequest` 等生命周期钩子
- **中间件系统**：支持多级中间件和自动排序

### 2. 存储系统 (Storage)
- **多适配器支持**：内置 SQLite 和 JSON 两种存储适配器
- **完整的 ACID 事务支持**：确保数据一致性
- **自定义数据类型**：支持 `DBNumber`、`DBString`、`DBBool`、`DBDateTime` 等
- **约束验证**：支持 `[unique]`、`[not null]` 等约束
- **关系映射**：支持多对多关系表和外键约束
- **惰性加载**：支持关系数据的延迟加载

## 安装

### 从GitHub拉取

```bash
git clone https://github.com/NightPoetry/cat-knight-core.git
cd cat-knight-core
npm install
```

### 本地使用

在项目中使用本地安装的包：

```bash
# 在你的项目目录中
npm install /path/to/cat-knight-core
```

## 快速开始

### 路由系统示例

```javascript
const { Router } = require('cat-knight-core');

// 创建外部工具
const tools = {
  logger: {
    info: (msg) => console.log(`[INFO] ${msg}`)
  }
};

// 创建路由实例
const router = new Router({ tools });

// 直接注册路由
router.register(
  { path: '/hello', method: 'GET' },
  function hello(ctx) {
    logger.info('Hello world route called');
    return { message: 'Hello World!' };
  },
  'public'
);

// 获取路由处理函数
const handler = router.getRouteHandler('public', '/hello', 'GET');

// 执行路由
const ctx = { path: '/hello', method: 'GET' };
handler(ctx).then(() => {
  console.log(ctx.body); // { message: 'Hello World!' }
});
```

### 存储系统示例

```javascript
const { Entity, SQLiteAdapter, DBNumber, DBString } = require('cat-knight-core');

// 初始化数据库适配器
const adapter = new SQLiteAdapter('./test.db');
await adapter.init();

// 定义实体
const userType = {
  name: 'User',
  fields: {
    id: { rawType: 'number[10] [primary]' },
    username: { rawType: 'str[50] [unique] [not null]' },
    balance: { rawType: 'number[10.2]', defaultValue: '0.00' }
  }
};

// 创建表
await adapter.ensureTable('User', userType);

// 创建实体实例
const user = new Entity(userType, {
  id: 1,
  username: 'testuser',
  balance: new DBNumber('100.50', 10, 2)
});

// 插入数据
await adapter.insert('User', user._data);

// 查询数据
const retrievedUser = await adapter.findOne('User', { id: 1 });
console.log(retrievedUser);
```

## 详细使用

### 路由语法

```javascript
// 路由配置
const config = {
  path: '/users',
  method: 'GET',
  requireRoles: ['user'],
  transaction: true
};

// 处理函数
async function users(ctx) {
  const users = await db.getAllUsers();
  return { users };
}

// 生命周期函数
function before(ctx) {
  ctx.startTime = Date.now();
}

function after(ctx) {
  ctx.endTime = Date.now();
}
```

### 存储类型

| 类型 | 描述 | 示例 |
|------|------|------|
| `DBNumber` | 高精度数字类型 | `new DBNumber('123.45', 10, 2)` |
| `DBString` | 字符串类型 | `new DBString('test', 50)` |
| `DBBool` | 布尔类型 | `new DBBool(true)` |
| `DBDateTime` | 日期时间类型 | `new DBDateTime(new Date())` |

## 测试

```bash
npm test
```

## 许可证

MIT

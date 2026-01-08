# RouterLoader - 单文件路由加载器

RouterLoader 是一个基于 Node.js VM 模块的单文件路由加载器，支持极简语法、安全级别设置和外部工具注入。

## 核心功能

- **单文件解析**：直接加载单个路由文件，无需复杂的目录结构
- **安全级别**：支持 private、public、protected 三个安全级别
- **外部工具注入**：允许外部传入工具字典，在路由中使用
- **自动包装 async**：所有路由处理函数自动包装为 async
- **返回值自动设置**：路由函数返回值自动设置为 ctx.body
- **生命周期函数支持**：支持 before、after、onRequest 等生命周期钩子

## 安装

```bash
npm install
```

## 快速开始

### 1. 创建路由文件

```javascript
// routes/hello.js
const config = {
  method: 'GET',
  description: 'Hello World路由'
};

function hello() {
  return { message: 'Hello World!', timestamp: new Date().toISOString() };
}
```

### 2. 使用 RouterLoader

```javascript
const RouterLoader = require('./router-loader');

// 创建外部工具
const tools = {
  logger: {
    info: (msg) => console.log(`[INFO] ${msg}`)
  },
  db: {
    getUser: (id) => ({ id, name: 'User' })
  }
};

// 创建路由加载器
const routerLoader = new RouterLoader({ tools });

// 加载路由文件
const route = routerLoader.loadRouteFile('./routes/hello.js', 'public');

// 执行路由处理函数
const ctx = {};
route.handler(ctx).then(() => {
  console.log(ctx.body); // { message: 'Hello World!', timestamp: '...' }
});
```

## 路由语法

### 配置对象

```javascript
const config = {
  // 必填
  method: 'GET',        // HTTP 方法
  
  // 认证与授权
  requireRoles: ['admin'],           // 所需角色
  requirePermissions: ['user.delete'], // 所需权限
  
  // 数据管理
  transaction: true,                 // 是否启用事务
  
  // 流量控制
  rateLimit: {
    max: 100,        // 最大请求数
    windowMs: 60000  // 时间窗口
  },
  
  // 缓存
  cache: {
    enabled: true,
    ttl: 300  // 缓存时间（秒）
  },
  
  // 其他
  description: '路由描述',
  deprecated: false
};
```

### 处理函数

```javascript
// 基本形式
function routeName(ctx) {
  // 业务逻辑
  return { result: 'success' };
}

// 支持 async/await
async function routeName(ctx) {
  const data = await db.query('SELECT * FROM users');
  return { data };
}

// 直接设置 ctx.body
function routeName(ctx) {
  ctx.body = { result: 'success' };
  ctx.status = 201;
}
```

### 生命周期函数

```javascript
// 请求前处理
function before(ctx) {
  ctx.startTime = Date.now();
}

// 请求后处理
function after(ctx) {
  ctx.endTime = Date.now();
  ctx.responseTime = ctx.endTime - ctx.startTime;
}

// 请求开始
function onRequest(ctx) {
  // 最先执行
}

// 响应前
function onResponse(ctx) {
  // 响应发送前执行
}

// 错误处理
function onError(ctx, error) {
  // 捕获错误
}

// 响应完成后（异步）
function onFinish(ctx) {
  // 不阻塞响应
}
```

## API 参考

### RouterLoader 构造函数

```javascript
const routerLoader = new RouterLoader(options);
```

**参数**：
- `options.tools`：外部工具字典，在路由中可用
- `options.sandbox`：额外的沙箱变量

### 方法

#### loadRouteFile(filePath, securityLevel, options)

加载单个路由文件。

**参数**：
- `filePath`：路由文件路径
- `securityLevel`：安全级别，可选值：`private`、`public`、`protected`
- `options.sandbox`：额外的沙箱变量

**返回值**：
- 路由对象，包含 `config`、`handler` 和生命周期函数

#### getRoutes()

获取所有加载的路由，按安全级别分类。

#### clearRoutes()

清空所有加载的路由。

#### addTool(name, tool)

添加单个外部工具。

#### addTools(tools)

添加多个外部工具。

## 安全级别

| 安全级别 | 描述 |
|---------|------|
| `private` | 仅允许 127.0.0.1 访问，用于内部管理、健康检查 |
| `public` | 无需认证，允许所有来源访问，用于登录、注册等 |
| `protected` | 需要 JWT 认证，用于用户操作、数据修改等 |

## 外部工具使用

在路由文件中可以直接使用注入的工具：

```javascript
// routes/user.js
const config = {
  method: 'GET',
  requireRoles: ['user']
};

async function user(ctx) {
  // 使用注入的 logger 工具
  logger.info('获取用户信息');
  
  // 使用注入的 db 工具
  const user = await db.getUser(ctx.params.id);
  
  return user;
}
```

## 示例

### 完整的 Koa 集成示例

查看 `example-server.js` 文件，展示了：
- Koa 服务器集成
- 中间件系统
- 多安全级别路由
- 外部工具注入

## 测试

运行测试：

```bash
node test-loader.js
```

启动示例服务器：

```bash
node example-server.js
```

## 设计思路

1. **VM 沙箱执行**：使用 Node.js VM 模块在沙箱中执行路由代码，隔离作用域
2. **极简语法**：无需 `module.exports`，直接声明变量和函数
3. **自动提取**：自动提取 `config` 和处理函数
4. **外部工具注入**：允许外部传入工具，路由中直接使用
5. **安全级别管理**：内置三个安全级别，便于权限控制

## 中间件加载器

### 核心功能
- **极简语法支持**：直接声明 `const config` 和生命周期函数
- **自动包装 async**：所有中间件函数自动包装为 async
- **完整生命周期**：支持 onRequest、before、after、onResponse、onError、onFinish
- **中间件排序**：基于 order 字段自动排序
- **级别管理**：支持 global、private、public、protected 四个级别
- **外部工具注入**：支持注入外部工具

### 使用示例

```javascript
const MiddlewareLoader = require('./middleware-loader');

// 创建中间件加载器
const middlewareLoader = new MiddlewareLoader({
  tools: {
    logger: { info: (msg) => console.log(msg) }
  }
});

// 加载中间件文件
middlewareLoader.loadMiddlewareFile('./logger-middleware.js');
middlewareLoader.loadMiddlewareFile('./jwt-middleware.js');
middlewareLoader.loadMiddlewareFile('./transaction-middleware.js');

// 组合中间件
const composed = middlewareLoader.composeMiddlewares('protected');

// 执行中间件
await composed.onRequest(ctx);
await composed.before(ctx);
await composed.after(ctx);
```

### 中间件语法

```javascript
// middleware/logger.js
const config = {
  level: ['global'],
  order: 1
};

function onRequest(ctx) {
  console.log(`${ctx.method} ${ctx.url}`);
}

function onFinish(ctx) {
  console.log(`${ctx.method} ${ctx.url} ${ctx.status}`);
}
```

## 扩展建议

1. **添加路由验证**：验证路由配置的合法性
2. **支持中间件排序**：已实现，基于 order 字段自动排序
3. **添加路由分组**：支持路由分组和前缀
4. **支持路由参数**：自动解析路由参数
5. **添加错误处理**：统一的错误处理机制

## 许可证

MIT

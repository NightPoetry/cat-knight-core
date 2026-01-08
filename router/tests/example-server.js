const Koa = require('koa');
const Router = require('@koa/router');
const RouterLoader = require('./router-loader');
const fs = require('fs');
const path = require('path');

// 创建Koa应用
const app = new Koa();

// 创建外部工具
const externalTools = {
  db: {
    // 模拟数据库操作
    users: [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' }
    ],
    getUserById: (id) => {
      return externalTools.db.users.find(user => user.id === id);
    },
    getAllUsers: () => {
      return externalTools.db.users;
    }
  },
  logger: {
    info: (msg) => {
      console.log(`[INFO] ${new Date().toISOString()} - ${msg}`);
    },
    error: (msg) => {
      console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`);
    }
  },
  jwt: {
    verify: (token) => {
      // 模拟JWT验证
      if (token === 'valid-token') {
        return { userId: 1, roles: ['user'] };
      }
      throw new Error('Invalid token');
    }
  }
};

// 创建路由加载器
const routerLoader = new RouterLoader({
  tools: externalTools
});

// 创建路由表
const routers = {
  private: new Router(),
  public: new Router(),
  protected: new Router()
};

// 模拟中间件系统
const middlewares = {
  // 公共中间件
  public: [
    async (ctx, next) => {
      externalTools.logger.info(`Public route accessed: ${ctx.method} ${ctx.url}`);
      await next();
    }
  ],
  // 受保护中间件（需要JWT）
  protected: [
    async (ctx, next) => {
      externalTools.logger.info(`Protected route accessed: ${ctx.method} ${ctx.url}`);
      const token = ctx.headers.authorization?.replace('Bearer ', '');
      try {
        ctx.user = externalTools.jwt.verify(token);
        await next();
      } catch (error) {
        ctx.status = 401;
        ctx.body = { success: false, error: 'Unauthorized' };
      }
    }
  ],
  // 私有中间件（仅本地访问）
  private: [
    async (ctx, next) => {
      externalTools.logger.info(`Private route accessed: ${ctx.method} ${ctx.url}`);
      const ip = ctx.request.ip;
      if (ip !== '127.0.0.1' && ip !== '::1') {
        ctx.status = 403;
        ctx.body = { success: false, error: 'Forbidden' };
        return;
      }
      await next();
    }
  ]
};

// 加载路由文件
function loadRoutes() {
  // 创建示例路由文件
  const exampleRoutes = {
    'public/hello.js': `const config = {
  method: 'GET',
  description: 'Hello World路由'
};

function hello() {
  return { message: 'Hello World!', timestamp: new Date().toISOString() };
}`,
    'protected/users.js': `const config = {
  method: 'GET',
  description: '获取用户列表',
  requireRoles: ['user']
};

function users() {
  const users = db.getAllUsers();
  logger.info('获取用户列表成功');
  return { users, count: users.length };
}`,
    'private/health.js': `const config = {
  method: 'GET',
  description: '健康检查'
};

function health() {
  return { status: 'ok', timestamp: new Date().toISOString(), service: 'router-loader' };
}`
  };

  // 保存示例路由文件
  Object.keys(exampleRoutes).forEach(routePath => {
    const fullPath = path.join(__dirname, 'example-routes', routePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, exampleRoutes[routePath]);
  });

  // 加载所有示例路由
  const routeDir = path.join(__dirname, 'example-routes');
  
  // 加载公开路由
  const publicRoutesDir = path.join(routeDir, 'public');
  if (fs.existsSync(publicRoutesDir)) {
    fs.readdirSync(publicRoutesDir).forEach(file => {
      if (file.endsWith('.js')) {
        const fullPath = path.join(publicRoutesDir, file);
        const route = routerLoader.loadRouteFile(fullPath, 'public');
        registerRoute(route);
      }
    });
  }

  // 加载受保护路由
  const protectedRoutesDir = path.join(routeDir, 'protected');
  if (fs.existsSync(protectedRoutesDir)) {
    fs.readdirSync(protectedRoutesDir).forEach(file => {
      if (file.endsWith('.js')) {
        const fullPath = path.join(protectedRoutesDir, file);
        const route = routerLoader.loadRouteFile(fullPath, 'protected');
        registerRoute(route);
      }
    });
  }

  // 加载私有路由
  const privateRoutesDir = path.join(routeDir, 'private');
  if (fs.existsSync(privateRoutesDir)) {
    fs.readdirSync(privateRoutesDir).forEach(file => {
      if (file.endsWith('.js')) {
        const fullPath = path.join(privateRoutesDir, file);
        const route = routerLoader.loadRouteFile(fullPath, 'private');
        registerRoute(route);
      }
    });
  }
}

// 注册路由到Koa Router
function registerRoute(route) {
  const router = routers[route.securityLevel];
  const method = route.config.method.toLowerCase();
  const path = `/${route.fileName}`;
  
  // 应用对应级别的中间件
  const levelMiddlewares = middlewares[route.securityLevel];
  
  // 注册路由
  router[method](path, ...levelMiddlewares, async (ctx) => {
    try {
      // 执行路由处理函数
      const result = await route.handler(ctx);
      if (result !== undefined && !ctx.body) {
        ctx.body = result;
      }
      ctx.status = ctx.status || 200;
    } catch (error) {
      externalTools.logger.error(`Route error: ${error.message}`);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Internal Server Error' };
    }
  });
  
  externalTools.logger.info(`Registered route: ${method.toUpperCase()} ${path} [${route.securityLevel}]`);
}

// 加载路由
loadRoutes();

// 注册路由到应用
app.use(routers.public.routes());
app.use(routers.public.allowedMethods());

app.use(routers.protected.routes());
app.use(routers.protected.allowedMethods());

app.use(routers.private.routes());
app.use(routers.private.allowedMethods());

// 启动服务器
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n=== Server Started ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`\nAvailable Routes:`);
  console.log(`  Public: http://localhost:${PORT}/hello`);
  console.log(`  Protected: http://localhost:${PORT}/users (needs Bearer valid-token)`);
  console.log(`  Private: http://localhost:${PORT}/health (only localhost)`);
  console.log(`\nUse Ctrl+C to stop the server`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log(`\n\n=== Server Stopped ===`);
  process.exit(0);
});
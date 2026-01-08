const Koa = require('koa');
const Router = require('@koa/router');
const RouterLoader = require('./router-loader');
const MiddlewareLoader = require('./middleware-loader');
const fs = require('fs');
const path = require('path');

// 创建 Koa 应用
const app = new Koa();

// 创建外部工具
const externalTools = {
  logger: {
    info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`)
  },
  db: {
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
  jwt: {
    verify: (token) => {
      // 模拟 JWT 验证
      if (token === 'valid-token') {
        return { userId: 1, roles: ['user'] };
      }
      throw new Error('Invalid token');
    }
  }
};

// 创建加载器实例
const routerLoader = new RouterLoader({ tools: externalTools });
const middlewareLoader = new MiddlewareLoader({ tools: externalTools });

// 创建示例中间件
const exampleMiddlewares = {
  'logger.js': `const config = { level: ['global'], order: 1 }; function onRequest(ctx) { logger.info(`${ctx.method} ${ctx.url} 请求开始`); } function onFinish(ctx) { logger.info(`${ctx.method} ${ctx.url} ${ctx.status} 请求完成`); }`,
  'response-formatter.js': `const config = { level: ['global'], order: -2 }; function after(ctx) { if (ctx.body && ctx.body.success === undefined) { ctx.body = { success: true, data: ctx.body, timestamp: Date.now() }; } }`,
  'jwt-auth.js': `const config = { level: ['protected'], order: 40 }; function before(ctx) { const token = ctx.headers.authorization?.replace('Bearer ', ''); if (!token) { ctx.throw(401, '缺少令牌'); } try { ctx.user = jwt.verify(token); } catch (error) { ctx.throw(401, '无效令牌'); } }`,
  'transaction.js': `const config = { level: ['protected'], order: 60 }; function before(ctx) { ctx.transaction = { query: (sql, params) => { logger.info(`执行 SQL: ${sql} ${JSON.stringify(params)}`); return [[db.getUserById(1)]]; }, commit: () => logger.info('事务提交'), rollback: () => logger.info('事务回滚') }; } function after(ctx) { if (ctx.status < 400) { ctx.transaction.commit(); } else { ctx.transaction.rollback(); } }`
};

// 创建示例路由
const exampleRoutes = {
  'public/hello.js': `const config = { method: 'GET', description: 'Hello World' }; function hello() { return { message: 'Hello World!', timestamp: new Date().toISOString() }; }`,
  'public/ping.js': `const config = { method: 'GET', description: '健康检查' }; function ping() { return { status: 'ok', timestamp: Date.now() }; }`,
  'protected/users.js': `const config = { method: 'GET', requireRoles: ['user'], description: '获取用户列表' }; function users() { const users = db.getAllUsers(); return { users, count: users.length }; }`,
  'protected/profile.js': `const config = { method: 'GET', requireRoles: ['user'], description: '获取用户信息' }; function profile(ctx) { const user = db.getUserById(ctx.user.userId); return user; }`
};

// 保存示例文件
function saveExampleFiles() {
  // 保存中间件
  const middlewareDir = path.join(__dirname, 'example-middlewares');
  if (!fs.existsSync(middlewareDir)) {
    fs.mkdirSync(middlewareDir, { recursive: true });
  }
  Object.keys(exampleMiddlewares).forEach(fileName => {
    const fullPath = path.join(middlewareDir, fileName);
    fs.writeFileSync(fullPath, exampleMiddlewares[fileName]);
  });

  // 保存路由
  const routeDir = path.join(__dirname, 'example-routes');
  if (!fs.existsSync(routeDir)) {
    fs.mkdirSync(routeDir, { recursive: true });
  }
  Object.keys(exampleRoutes).forEach(routePath => {
    const fullPath = path.join(routeDir, routePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, exampleRoutes[routePath]);
  });
}

// 加载所有示例文件
function loadAllFiles() {
  // 加载中间件
  const middlewareDir = path.join(__dirname, 'example-middlewares');
  if (fs.existsSync(middlewareDir)) {
    fs.readdirSync(middlewareDir).forEach(file => {
      if (file.endsWith('.js')) {
        const fullPath = path.join(middlewareDir, file);
        middlewareLoader.loadMiddlewareFile(fullPath);
        externalTools.logger.info(`加载中间件: ${file}`);
      }
    });
  }

  // 加载路由
  const routeDir = path.join(__dirname, 'example-routes');
  ['private', 'public', 'protected'].forEach(level => {
    const levelDir = path.join(routeDir, level);
    if (fs.existsSync(levelDir)) {
      fs.readdirSync(levelDir).forEach(file => {
        if (file.endsWith('.js')) {
          const fullPath = path.join(levelDir, file);
          routerLoader.loadRouteFile(fullPath, level);
          externalTools.logger.info(`加载路由: ${level}/${file}`);
        }
      });
    }
  });
}

// 创建路由处理函数
function createRouteHandler(route) {
  return async (ctx) => {
    try {
      // 获取对应级别的中间件
      const composed = middlewareLoader.composeMiddlewares(route.securityLevel);
      
      // 执行请求生命周期
      await composed.onRequest(ctx);
      await composed.before(ctx);
      
      // 执行业务路由
      const result = await route.handler(ctx);
      if (result !== undefined && !ctx.body) {
        ctx.body = result;
      }
      ctx.status = ctx.status || 200;
      
      // 执行响应生命周期
      await composed.after(ctx);
      await composed.onResponse(ctx);
      
      // 执行异步完成回调
      process.nextTick(() => {
        composed.onFinish(ctx).catch(externalTools.logger.error);
      });
    } catch (error) {
      // 执行错误处理中间件
      const composed = middlewareLoader.composeMiddlewares(route.securityLevel);
      await composed.onError(ctx, error);
      
      // 确保返回错误响应
      if (!ctx.body) {
        ctx.status = error.status || 500;
        ctx.body = { success: false, error: { message: error.message } };
      }
      
      // 执行异步完成回调
      process.nextTick(() => {
        composed.onFinish(ctx).catch(externalTools.logger.error);
      });
    }
  };
}

// 注册所有路由
function registerAllRoutes() {
  const routers = {
    private: new Router(),
    public: new Router(),
    protected: new Router()
  };

  const routes = routerLoader.getRoutes();
  
  // 注册路由
  Object.keys(routes).forEach(level => {
    const levelRoutes = routes[level];
    const router = routers[level];
    
    levelRoutes.forEach(route => {
      const method = route.config.method.toLowerCase();
      const path = `/${route.fileName}`;
      
      router[method](path, createRouteHandler(route));
      externalTools.logger.info(`注册路由: ${method.toUpperCase()} ${path} [${level}]`);
    });
  });

  // 应用路由
  Object.values(routers).forEach(router => {
    app.use(router.routes());
    app.use(router.allowedMethods());
  });
}

// 启动应用
async function startApp() {
  console.log('=== 集成示例启动 ===\n');
  
  // 保存并加载示例文件
  saveExampleFiles();
  loadAllFiles();
  
  // 注册路由
  registerAllRoutes();
  
  // 启动服务器
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`\n=== 服务器启动成功 ===`);
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`\n可用路由:`);
    console.log(`  GET  http://localhost:${PORT}/hello          [public]`);
    console.log(`  GET  http://localhost:${PORT}/ping          [public]`);
    console.log(`  GET  http://localhost:${PORT}/users         [protected] (需要 Bearer valid-token)`);
    console.log(`  GET  http://localhost:${PORT}/profile       [protected] (需要 Bearer valid-token)`);
    console.log(`\n使用 Ctrl+C 停止服务器`);
  });
}

// 启动应用
startApp().catch(error => {
  externalTools.logger.error(`应用启动失败: ${error.message}`);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log(`\n\n=== 服务器停止 ===`);
  process.exit(0);
});
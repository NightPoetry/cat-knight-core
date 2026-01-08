const vm = require('vm');

class Router {
  constructor(options = {}) {
    this.tools = options.tools || {};
    this.routes = {
      private: [],
      public: [],
      protected: []
    };
    this.middlewares = {
      global: [],
      private: [],
      public: [],
      protected: []
    };
  }

  /**
   * 注册中间件
   * @param {Object} middleware - 中间件对象
   * @returns {Router} - 返回自身，支持链式调用
   */
  use(middleware) {
    // 直接注册中间件对象
    this._registerMiddleware(middleware);
    return this;
  }

  /**
   * 加载路由代码
   * @param {string} code - 路由代码文本
   * @param {string} fileName - 路由文件名
   * @param {string} securityLevel - 安全级别
   * @returns {Object} - 加载的路由信息
   */
  loadRouteCode(code, fileName, securityLevel) {
    if (!['private', 'public', 'protected'].includes(securityLevel)) {
      throw new Error(`Invalid security level: ${securityLevel}`);
    }

    // 提取路由配置和处理函数
    const extracted = this._extractRoute(code, fileName);
    
    // 生成路由路径（支持多种匹配方式）
    const route = {
      ...extracted,
      securityLevel,
      fileName: fileName,
      rawFileName: fileName,
      camelCaseName: fileName.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
    };

    this.routes[securityLevel].push(route);
    return route;
  }

  /**
   * 注册路由
   * @param {Object} routeConfig - 路由配置
   * @param {Function} handler - 路由处理函数
   * @param {string} securityLevel - 安全级别
   * @returns {Router} - 返回自身，支持链式调用
   */
  register(routeConfig, handler, securityLevel = 'public') {
    if (!['private', 'public', 'protected'].includes(securityLevel)) {
      throw new Error(`Invalid security level: ${securityLevel}`);
    }

    // 生成路由文件名和路径匹配信息
    const routePath = routeConfig.path || '';
    const fileName = routePath.replace(/^\//, '') || 'custom';
    const camelCaseName = fileName.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

    // 为直接注册的路由创建带有工具访问权限的处理函数
    const router = this;
    const wrappedHandler = async (ctx) => {
      // 将tools注入到处理函数的执行上下文中
      const sandbox = {
        ...router.tools,
        ctx: ctx
      };
      
      // 使用apply执行原始处理函数，确保this指向sandbox
      return await handler.apply(sandbox, [ctx]);
    };

    const route = {
      config: routeConfig,
      handler: this._wrapAsync(wrappedHandler),
      securityLevel,
      fileName: fileName,
      rawFileName: fileName,
      camelCaseName: camelCaseName
    };

    this.routes[securityLevel].push(route);
    return this;
  }

  /**
   * 获取路由处理函数
   * @param {string} securityLevel - 安全级别
   * @param {string} path - 路径
   * @param {string} method - HTTP方法
   * @returns {Function|null} - 路由处理函数
   */
  getRouteHandler(securityLevel, path, method) {
    const levelRoutes = this.routes[securityLevel] || [];
    
    // 匹配路由：支持多种匹配方式
    const route = levelRoutes.find(r => {
      // 检查方法匹配
      if (r.config.method !== method) {
        return false;
      }
      
      // 1. 精确匹配配置的path
      if (r.config.path && r.config.path === path) {
        return true;
      }
      
      // 2. 基于文件名的匹配（兼容文件加载方式）
      const possiblePaths = [
        `/${r.fileName}`,           // 原始文件名路径
        `/${r.camelCaseName}`       // 驼峰式文件名路径
      ];
      
      // 检查是否匹配任何可能的路径
      return possiblePaths.includes(path);
    });

    if (!route) return null;

    // 创建完整的处理函数，包含中间件调用
    return async (ctx) => {
      // 初始化上下文状态
      ctx.state = ctx.state || {};
      
      const composed = this._composeMiddlewares(securityLevel);
      
      try {
        // 执行请求生命周期
        await composed.onRequest(ctx);
        await composed.before(ctx);
        
        // 检查是否已经设置了状态码（中间件可能已经处理了请求）
        if (ctx.status && ctx.status >= 400) {
          // 中间件已经处理了请求，直接返回
          // 执行响应生命周期
          await composed.after(ctx);
          await composed.onResponse(ctx);
          
          // 异步执行onFinish
          process.nextTick(() => {
            composed.onFinish(ctx).catch(console.error);
          });
          return;
        }
        
        // 执行业务路由
        const result = await route.handler(ctx);
        if (result !== undefined && !ctx.body) {
          ctx.body = result;
        }
        ctx.status = ctx.status || 200;
        
        // 执行响应生命周期
        await composed.after(ctx);
        await composed.onResponse(ctx);
        
        // 异步执行onFinish
        process.nextTick(() => {
          composed.onFinish(ctx).catch(console.error);
        });
      } catch (error) {
        // 执行错误处理
        const composed = this._composeMiddlewares(securityLevel);
        await composed.onError(ctx, error);
        
        if (!ctx.body) {
          ctx.status = error.status || 500;
          ctx.body = { success: false, error: { message: error.message } };
        }
        
        // 异步执行onFinish
        process.nextTick(() => {
          composed.onFinish(ctx).catch(console.error);
        });
      }
    };
  }

  /**
   * 加载中间件代码
   * @param {string} code - 中间件代码文本
   * @param {string} fileName - 中间件文件名
   * @returns {Object} - 中间件对象
   */
  loadMiddlewareCode(code, fileName) {
    const middlewareObj = this._extractMiddleware(code, fileName);
    this._registerMiddleware(middlewareObj);
    return middlewareObj;
  }

  /**
   * 提取中间件配置和处理函数
   * @param {string} code - 中间件代码
   * @param {string} fileName - 文件名
   * @returns {Object} - 中间件对象
   */
  _extractMiddleware(code, fileName) {
    const sandbox = {
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Buffer,
      ...this.tools
    };

    const fullCode = `
      (function() {
        const extracted = {};
        
        ${code}
        
        if (typeof config !== 'undefined') extracted.config = config;
        if (typeof handler !== 'undefined') extracted.handler = handler;
        if (typeof before !== 'undefined') extracted.before = before;
        if (typeof after !== 'undefined') extracted.after = after;
        if (typeof onRequest !== 'undefined') extracted.onRequest = onRequest;
        if (typeof onResponse !== 'undefined') extracted.onResponse = onResponse;
        if (typeof onError !== 'undefined') extracted.onError = onError;
        if (typeof onFinish !== 'undefined') extracted.onFinish = onFinish;
        
        return extracted;
      })()`;

    try {
      const script = new vm.Script(fullCode);
      const extracted = script.runInNewContext(sandbox);
      
      if (!extracted.config) {
        throw new Error('Middleware config not found');
      }
      
      // 自动包装async
      return {
        ...extracted,
        handler: this._wrapAsync(extracted.handler),
        before: this._wrapAsync(extracted.before),
        after: this._wrapAsync(extracted.after),
        onRequest: this._wrapAsync(extracted.onRequest),
        onResponse: this._wrapAsync(extracted.onResponse),
        onError: this._wrapAsync(extracted.onError),
        onFinish: this._wrapAsync(extracted.onFinish)
      };
    } catch (error) {
      throw new Error(`Failed to extract middleware: ${error.message}`);
    }
  }

  /**
   * 注册中间件
   * @param {Object} middleware - 中间件对象
   */
  _registerMiddleware(middleware) {
    if (!middleware.config) {
      throw new Error('Middleware config not found');
    }

    // 设置默认配置
    middleware.config.level = middleware.config.level || ['global'];
    middleware.config.order = middleware.config.order || 0;
    middleware.config.enabled = middleware.config.enabled !== false;

    // 注册到指定级别
    middleware.config.level.forEach(level => {
      if (this.middlewares[level]) {
        this.middlewares[level].push(middleware);
      }
    });
  }

  /**
   * 提取路由配置和处理函数
   * @param {string} code - 路由代码
   * @param {string} fileName - 文件名
   * @returns {Object} - 路由对象
   */
  _extractRoute(code, fileName) {
    const sandbox = {
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Buffer,
      ...this.tools
    };

    // 将文件名转换为有效的函数名
    const safeFileName = fileName.replace(/[^a-zA-Z0-9_]/g, '_');
    const camelCaseName = safeFileName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    
    // 构建用于提取处理函数的代码
    // 首先尝试直接提取函数，然后尝试通过函数名提取
    const fullCode = `
      (function() {
        const extracted = {};
        let handler = null;
        
        // 执行原始代码
        ${code}
        
        // 提取配置
        if (typeof config !== 'undefined') extracted.config = config;
        
        // 尝试提取处理函数的多种方式
        try {
          // 1. 检查是否有与文件名匹配的函数
          if (typeof ${safeFileName} !== 'undefined') {
            handler = ${safeFileName};
          } 
          // 2. 检查是否有驼峰式函数名
          else if (typeof ${camelCaseName} !== 'undefined') {
            handler = ${camelCaseName};
          }
        } catch (e) {
          // 忽略错误，继续尝试其他方式
        }
        
        // 3. 如果有exported对象，尝试从其中提取
        if (!handler && typeof exported !== 'undefined') {
          handler = exported[${JSON.stringify(safeFileName)}] || 
                   exported[${JSON.stringify(camelCaseName)}] ||
                   exported.default;
        }
        
        // 4. 如果有module.exports，尝试从中提取
        if (!handler && typeof module !== 'undefined' && module.exports) {
          handler = module.exports[${JSON.stringify(safeFileName)}] || 
                   module.exports[${JSON.stringify(camelCaseName)}] ||
                   module.exports;
        }
        
        extracted.handler = handler;
        return extracted;
      })()`;

    try {
      const script = new vm.Script(fullCode);
      const extracted = script.runInNewContext(sandbox);
      
      if (!extracted.config) {
        throw new Error('Route config not found');
      }
      if (!extracted.handler || typeof extracted.handler !== 'function') {
        throw new Error(`Handler function not found: ${fileName}`);
      }
      
      // 自动包装async
      extracted.handler = this._wrapAsync(extracted.handler);
      
      return extracted;
    } catch (error) {
      throw new Error(`Failed to extract route: ${error.message}`);
    }
  }

  /**
   * 包装函数为async
   * @param {Function} fn - 要包装的函数
   * @returns {Function} - 包装后的async函数
   */
  _wrapAsync(fn) {
    if (!fn || typeof fn !== 'function') {
      return async () => {};
    }
    return async (ctx, ...args) => {
      return await fn(ctx, ...args);
    };
  }

  /**
   * 组合中间件
   * @param {string} securityLevel - 安全级别
   * @returns {Object} - 包含各阶段中间件的执行函数
   */
  _composeMiddlewares(securityLevel) {
    const levelMiddlewares = this.middlewares[securityLevel] || [];
    const globalMiddlewares = this.middlewares.global || [];
    
    // 合并并过滤启用的中间件
    const allMiddlewares = [...globalMiddlewares, ...levelMiddlewares]
      .filter(mw => mw.config.enabled);

    // 按order排序
    const sorted = this._sortMiddlewares(allMiddlewares);

    // 分离各阶段中间件
    const onRequestMiddlewares = sorted.filter(mw => mw.onRequest);
    const beforeMiddlewares = sorted.filter(mw => mw.before || mw.handler);
    const afterMiddlewares = sorted.filter(mw => mw.after);
    const onResponseMiddlewares = sorted.filter(mw => mw.onResponse);
    const onErrorMiddlewares = sorted.filter(mw => mw.onError);
    const onFinishMiddlewares = sorted.filter(mw => mw.onFinish);

    // 保存this上下文
    const router = this;

    return {
      async onRequest(ctx) {
        for (const mw of onRequestMiddlewares) {
          if (!router._shouldExclude(mw, ctx)) {
            await mw.onRequest(ctx);
          }
        }
      },

      async before(ctx) {
        for (const mw of beforeMiddlewares) {
          if (!router._shouldExclude(mw, ctx)) {
            if (mw.handler) {
              await mw.handler(ctx);
            }
            if (mw.before) {
              await mw.before(ctx);
            }
          }
        }
      },

      async after(ctx) {
        // 倒序执行after中间件
        for (const mw of afterMiddlewares.reverse()) {
          if (!router._shouldExclude(mw, ctx)) {
            await mw.after(ctx);
          }
        }
      },

      async onResponse(ctx) {
        for (const mw of onResponseMiddlewares) {
          if (!router._shouldExclude(mw, ctx)) {
            await mw.onResponse(ctx);
          }
        }
      },

      async onError(ctx, error) {
        for (const mw of onErrorMiddlewares) {
          if (!router._shouldExclude(mw, ctx)) {
            await mw.onError(ctx, error);
          }
        }
      },

      async onFinish(ctx) {
        for (const mw of onFinishMiddlewares) {
          if (!router._shouldExclude(mw, ctx)) {
            await mw.onFinish(ctx);
          }
        }
      }
    };
  }

  /**
   * 中间件排序
   * @param {Array} middlewares - 中间件列表
   * @returns {Array} - 排序后的中间件列表
   */
  _sortMiddlewares(middlewares) {
    return [...middlewares].sort((a, b) => {
      const orderA = a.config.order;
      const orderB = b.config.order;
      
      if (orderA >= 0 && orderB >= 0) {
        return orderA - orderB;
      }
      if (orderA < 0 && orderB < 0) {
        return Math.abs(orderB) - Math.abs(orderA);
      }
      return orderA >= 0 ? -1 : 1;
    });
  }

  /**
   * 检查是否排除中间件
   * @param {Object} middleware - 中间件对象
   * @param {Object} ctx - Koa上下文
   * @returns {boolean} - 是否排除
   */
  _shouldExclude(middleware, ctx) {
    const exclude = middleware.config.exclude || [];
    return exclude.some(path => {
      if (typeof path === 'string') {
        return ctx.path === path || ctx.path.startsWith(`${path}/`);
      }
      if (path instanceof RegExp) {
        return path.test(ctx.path);
      }
      return false;
    });
  }

  /**
   * 获取所有路由
   * @returns {Object} - 路由列表
   */
  getRoutes() {
    return { ...this.routes };
  }

  /**
   * 获取所有中间件
   * @returns {Object} - 中间件列表
   */
  getMiddlewares() {
    return { ...this.middlewares };
  }
}

module.exports = Router;
// 测试内置中间件功能
const Router = require('../router');

// 创建路由实例
const router = new Router({
  tools: {
    testTool: () => 'Hello from test tool'
  }
});

// 加载内置中间件
const jwtMiddleware = require('../middlewares/jwt');
const loggerMiddleware = require('../middlewares/logger');
const corsMiddleware = require('../middlewares/cors');
const errorHandlerMiddleware = require('../middlewares/error-handler');
const responseFormatterMiddleware = require('../middlewares/response-formatter');

// 注册中间件
router.use(jwtMiddleware);
router.use(loggerMiddleware);
router.use(corsMiddleware);
router.use(errorHandlerMiddleware);
router.use(responseFormatterMiddleware);

// 测试用例集合
const testCases = [];

// 测试1：验证中间件注册
function testMiddlewareRegistration() {
  console.log('=== 测试1：验证中间件注册 ===');
  
  const middlewares = router.getMiddlewares();
  let passed = true;
  
  // 检查是否包含所有内置中间件
  const middlewareNames = [
    'jwt-auth',
    'logger',
    'cors',
    'error-handler',
    'response-formatter'
  ];
  
  for (const level in middlewares) {
    middlewares[level].forEach(mw => {
      if (middlewareNames.includes(mw.config.name)) {
        console.log(`✓ 中间件 ${mw.config.name} 已注册到 ${level} 级别`);
      }
    });
  }
  
  // 验证中间件数量
  const totalMiddlewares = Object.values(middlewares)
    .reduce((sum, arr) => sum + arr.length, 0);
  
  if (totalMiddlewares >= 5) {
    console.log(`✓ 成功注册了 ${totalMiddlewares} 个中间件`);
  } else {
    console.error(`✗ 注册的中间件数量不足，预期至少 5 个，实际 ${totalMiddlewares} 个`);
    passed = false;
  }
  
  return passed;
}

testCases.push(testMiddlewareRegistration);

// 测试2：验证中间件执行顺序
function testMiddlewareOrder() {
  console.log('\n=== 测试2：验证中间件执行顺序 ===');
  
  const middlewares = router.getMiddlewares();
  const globalMiddlewares = middlewares.global || [];
  
  // 按order排序中间件
  const sortedMiddlewares = [...globalMiddlewares].sort((a, b) => {
    const orderA = a.config.order;
    const orderB = b.config.order;
    
    if (orderA >= 0 && orderB >= 0) {
      return orderA - orderB;
    }
    if (orderA < 0 && orderB < 0) {
      return orderA - orderB;
    }
    return orderA >= 0 ? -1 : 1;
  });
  
  // 预期的执行顺序
  const expectedOrder = [
    'logger',        // order: 1
    'cors',          // order: 10
    'response-formatter', // order: -2
    'error-handler'  // order: -1
  ];
  
  // 过滤出我们关心的中间件
  const filteredMiddlewares = sortedMiddlewares
    .filter(mw => expectedOrder.includes(mw.config.name))
    .map(mw => mw.config.name);
  
  console.log('实际执行顺序:', filteredMiddlewares);
  console.log('预期执行顺序:', expectedOrder);
  
  const passed = JSON.stringify(filteredMiddlewares) === JSON.stringify(expectedOrder);
  
  if (passed) {
    console.log('✓ 中间件执行顺序符合预期');
  } else {
    console.error('✗ 中间件执行顺序不符合预期');
  }
  
  return passed;
}

testCases.push(testMiddlewareOrder);

// 测试3：测试响应格式化中间件
function testResponseFormatter() {
  console.log('\n=== 测试3：测试响应格式化中间件 ===');
  
  // 注册测试路由
  router.register(
    {
      method: 'GET',
      path: '/test-formatter'
    },
    (ctx) => {
      return { message: 'Test response', data: { value: 123 } };
    }
  );
  
  // 模拟请求
  const ctx = {
    path: '/test-formatter',
    method: 'GET',
    status: null,
    body: null,
    headers: {},
    state: {},
    set: (key, value) => {
      ctx.responseHeaders = ctx.responseHeaders || {};
      ctx.responseHeaders[key] = value;
    },
    get: (key) => {
      return ctx.responseHeaders && ctx.responseHeaders[key];
    }
  };
  
  // 模拟中间件执行
  return new Promise((resolve) => {
    const handler = router.getRouteHandler('public', '/test-formatter', 'GET');
    
    if (handler) {
      handler(ctx).then(() => {
        console.log('原始响应:', ctx.body);
        
        // 检查是否格式化
        const passed = ctx.body && ctx.body.success === true && ctx.body.data;
        
        if (passed) {
          console.log('✓ 响应格式化成功');
          resolve(true);
        } else {
          console.error('✗ 响应格式化失败');
          resolve(false);
        }
      }).catch(error => {
        console.error('✗ 测试响应格式化时出错:', error.message);
        resolve(false);
      });
    } else {
      console.error('✗ 未找到路由处理函数');
      resolve(false);
    }
  });
}

testCases.push(testResponseFormatter);

// 测试4：测试CORS中间件
function testCorsMiddleware() {
  console.log('\n=== 测试4：测试CORS中间件 ===');
  
  // 注册测试路由
  router.register(
    {
      method: 'GET',
      path: '/test-cors'
    },
    (ctx) => {
      return { message: 'CORS test' };
    }
  );
  
  // 模拟带有Origin头的请求
  const ctx = {
    path: '/test-cors',
    method: 'GET',
    status: null,
    body: null,
    headers: {
      origin: 'http://example.com'
    },
    set: (key, value) => {
      ctx.responseHeaders = ctx.responseHeaders || {};
      ctx.responseHeaders[key] = value;
    },
    state: {}
  };
  
  // 模拟中间件执行
  return new Promise((resolve) => {
    const handler = router.getRouteHandler('public', '/test-cors', 'GET');
    
    if (handler) {
      handler(ctx).then(() => {
        console.log('响应头:', ctx.responseHeaders);
        
        // 检查是否设置了CORS头
        const passed = ctx.responseHeaders && 
                      ctx.responseHeaders['Access-Control-Allow-Origin'] === 'http://example.com' &&
                      ctx.responseHeaders['Access-Control-Allow-Credentials'] === 'true';
        
        if (passed) {
          console.log('✓ CORS中间件工作正常');
          resolve(true);
        } else {
          console.error('✗ CORS中间件工作异常');
          resolve(false);
        }
      }).catch(error => {
        console.error('✗ 测试CORS中间件时出错:', error.message);
        resolve(false);
      });
    } else {
      console.error('✗ 未找到路由处理函数');
      resolve(false);
    }
  });
}

testCases.push(testCorsMiddleware);

// 测试5：测试错误处理中间件
function testErrorHandler() {
  console.log('\n=== 测试5：测试错误处理中间件 ===');
  
  // 注册会抛出错误的路由
  router.register(
    {
      method: 'GET',
      path: '/test-error'
    },
    (ctx) => {
      throw new Error('Test error message');
    }
  );
  
  // 模拟请求
  const ctx = {
    path: '/test-error',
    method: 'GET',
    status: null,
    body: null,
    headers: {},
    state: {},
    set: (key, value) => {
      ctx.responseHeaders = ctx.responseHeaders || {};
      ctx.responseHeaders[key] = value;
    },
    get: (key) => {
      return ctx.responseHeaders && ctx.responseHeaders[key];
    }
  };
  
  // 模拟中间件执行
  return new Promise((resolve) => {
    const handler = router.getRouteHandler('public', '/test-error', 'GET');
    
    if (handler) {
      handler(ctx).then(() => {
        console.log('错误响应:', ctx.body);
        
        // 检查是否正确处理错误
        const passed = ctx.body && ctx.body.success === false && ctx.body.error;
        
        if (passed) {
          console.log('✓ 错误处理中间件工作正常');
          resolve(true);
        } else {
          console.error('✗ 错误处理中间件工作异常');
          resolve(false);
        }
      }).catch(error => {
        console.error('✗ 测试错误处理中间件时出错:', error.message);
        resolve(false);
      });
    } else {
      console.error('✗ 未找到路由处理函数');
      resolve(false);
    }
  });
}

testCases.push(testErrorHandler);

// 运行所有测试用例
async function runTests() {
  console.log('开始测试内置中间件...');
  
  let passedCount = 0;
  let totalCount = 0;
  
  for (const testCase of testCases) {
    totalCount++;
    
    try {
      const result = await testCase();
      if (result === true || result === undefined) {
        passedCount++;
      }
    } catch (error) {
      console.error(`测试用例执行出错: ${error.message}`);
    }
  }
  
  console.log('\n=== 测试结果汇总 ===');
  console.log(`总测试用例数: ${totalCount}`);
  console.log(`通过测试数: ${passedCount}`);
  console.log(`失败测试数: ${totalCount - passedCount}`);
  
  if (passedCount === totalCount) {
    console.log('✅ 所有测试用例均通过！');
  } else {
    console.log('❌ 有测试用例失败！');
    process.exit(1);
  }
}

// 执行测试
runTests();
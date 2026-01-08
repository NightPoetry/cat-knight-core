// 测试直接注册路由功能
const Router = require('../router');

// 创建路由实例
const router = new Router({
  tools: {
    testTool: () => 'Hello from test tool'
  }
});

// 测试1：直接注册路由（使用path配置）
console.log('=== 测试1：直接注册路由（使用path配置） ===');
router.register(
  {
    method: 'GET',
    path: '/direct-route'
  },
  function(ctx) {
    return {
      message: 'Hello from direct route',
      toolResult: this.testTool()
    };
  },
  'public'
);

// 测试2：直接注册路由（不使用path配置）
console.log('\n=== 测试2：直接注册路由（不使用path配置） ===');
router.register(
  {
    method: 'POST'
  },
  (ctx) => {
    return {
      message: 'Hello from direct route without path',
      body: ctx.body
    };
  },
  'public'
);

// 测试3：注册中间件
console.log('\n=== 测试3：注册中间件 ===');
router.use({
  config: {
    name: 'test-middleware',
    level: ['global'],
    order: 1
  },
  async onRequest(ctx) {
    ctx.middlewareExecuted = true;
    console.log('中间件 onRequest 执行');
  },
  async before(ctx) {
    console.log('中间件 before 执行');
  },
  async after(ctx) {
    console.log('中间件 after 执行');
  },
  async onResponse(ctx) {
    console.log('中间件 onResponse 执行');
  }
});

// 测试4：测试基于path配置的路由匹配
console.log('\n=== 测试4：测试基于path配置的路由匹配 ===');
const handler1 = router.getRouteHandler('public', '/direct-route', 'GET');
if (handler1) {
  console.log('基于path配置的路由匹配成功');
  
  // 执行路由处理函数
  const ctx1 = {
    path: '/direct-route',
    method: 'GET',
    status: null,
    body: null
  };
  
  handler1(ctx1).then(() => {
    console.log('路由执行结果:', ctx1.body);
    console.log('状态码:', ctx1.status);
    console.log('中间件是否执行:', ctx1.middlewareExecuted);
  }).catch(error => {
    console.error('路由执行错误:', error);
  });
} else {
  console.error('基于path配置的路由匹配失败');
}

// 测试5：测试基于文件名的路由匹配（无path配置）
console.log('\n=== 测试5：测试基于文件名的路由匹配（无path配置） ===');
const handler2 = router.getRouteHandler('public', '/custom', 'POST');
if (handler2) {
  console.log('基于文件名的路由匹配成功');
  
  // 执行路由处理函数
  const ctx2 = {
    path: '/custom',
    method: 'POST',
    status: null,
    body: { test: 'data' }
  };
  
  handler2(ctx2).then(() => {
    console.log('路由执行结果:', ctx2.body);
    console.log('状态码:', ctx2.status);
  }).catch(error => {
    console.error('路由执行错误:', error);
  });
} else {
  console.error('基于文件名的路由匹配失败');
}

// 测试6：测试链式调用
console.log('\n=== 测试6：测试链式调用 ===');
router
  .register(
    { method: 'PUT', path: '/chain1' },
    (ctx) => ({ message: 'Chain 1' })
  )
  .register(
    { method: 'DELETE', path: '/chain2' },
    (ctx) => ({ message: 'Chain 2' })
  )
  .use({
    config: { name: 'chain-middleware', level: ['global'] },
    async before(ctx) {
      ctx.chainMiddleware = true;
    }
  });

const handler3 = router.getRouteHandler('public', '/chain1', 'PUT');
if (handler3) {
  console.log('链式调用注册路由成功');
  const ctx3 = {
    path: '/chain1',
    method: 'PUT',
    status: null,
    body: null
  };
  handler3(ctx3).then(() => {
    console.log('链式路由执行结果:', ctx3.body);
    console.log('链式中间件是否执行:', ctx3.chainMiddleware);
  });
} else {
  console.error('链式调用注册路由失败');
}

console.log('\n=== 所有测试完成 ===');

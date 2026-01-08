// 测试重构后的路由系统
const Router = require('../router');

// 创建路由实例
const router = new Router({
  tools: {
    testTool: () => 'Hello from test tool'
  }
});

// 测试1：加载路由代码
console.log('=== 测试1：加载路由代码 ===');
const routeCode = `
const config = {
  method: 'GET',
  path: '/test-route'
};

function testRoute(ctx) {
  return { 
    message: 'Hello from test route',
    toolResult: testTool()
  };
}
`;

const route = router.loadRouteCode(routeCode, 'test-route', 'public');
console.log('加载的路由:', route.config);

// 测试2：加载中间件代码
console.log('\n=== 测试2：加载中间件代码 ===');
const middlewareCode = `
const config = {
  name: 'test-middleware',
  level: ['global'],
  order: 1
};

async function onRequest(ctx) {
  ctx.middlewareExecuted = true;
  console.log('中间件 onRequest 执行');
}

async function before(ctx) {
  console.log('中间件 before 执行');
}

async function after(ctx) {
  console.log('中间件 after 执行');
}

async function onResponse(ctx) {
  console.log('中间件 onResponse 执行');
}
`;

const middleware = router.loadMiddlewareCode(middlewareCode, 'test-middleware');
console.log('加载的中间件:', middleware.config);

// 测试3：直接注册中间件
console.log('\n=== 测试3：直接注册中间件 ===');
const directMiddleware = {
  config: {
    name: 'direct-middleware',
    level: ['global'],
    order: 2
  },
  async before(ctx) {
    console.log('直接注册的中间件 before 执行');
  }
};

router.use(directMiddleware);

// 测试4：获取路由处理函数
console.log('\n=== 测试4：获取路由处理函数 ===');
const handler = router.getRouteHandler('public', '/test-route', 'GET');
if (handler) {
  console.log('路由处理函数获取成功');
  
  // 测试5：执行路由处理函数
  console.log('\n=== 测试5：执行路由处理函数 ===');
  const ctx = {
    path: '/test-route',
    method: 'GET',
    status: null,
    body: null
  };
  
  handler(ctx).then(() => {
    console.log('路由执行结果:', ctx.body);
    console.log('状态码:', ctx.status);
    console.log('中间件是否执行:', ctx.middlewareExecuted);
    console.log('\n=== 所有测试完成 ===');
  }).catch(error => {
    console.error('路由执行错误:', error);
  });
} else {
  console.error('路由处理函数获取失败');
}

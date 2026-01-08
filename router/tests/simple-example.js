const Router = require('../router');

// 创建外部工具
const externalTools = {
  logger: {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
  }
};

// 创建路由实例
const router = new Router({
  tools: externalTools
});

console.log('=== 新路由组件示例 ===\n');

// 直接注册中间件（不通过文件）
console.log('1. 直接注册中间件...');
router.use({
  config: { level: ['global'], order: 1 },
  onRequest: function(ctx) {
    externalTools.logger.info(`${ctx.method} ${ctx.url} 请求开始`);
    ctx.state.startTime = Date.now();
  },
  onFinish: function(ctx) {
    const duration = Date.now() - ctx.state.startTime;
    externalTools.logger.info(`${ctx.method} ${ctx.url} ${ctx.status} 请求完成`);
  }
});
console.log('✓ 中间件注册成功\n');

// 直接注册路由（不通过文件）
console.log('2. 直接注册路由...');
router.register(
  { method: 'GET', description: 'Hello路由' },
  function() {
    return { message: 'Hello World!' };
  },
  'public'
);
console.log('✓ 路由注册成功\n');

// 模拟请求
console.log('3. 模拟请求...');
const mockCtx = {
  method: 'GET',
  url: '/custom',
  path: '/custom',
  status: 200,
  state: {},
  body: null
};

// 获取并执行路由处理函数
const handler = router.getRouteHandler('public', '/custom', 'GET');
if (handler) {
  handler(mockCtx).then(() => {
    console.log('✓ 请求处理完成');
    console.log('响应:', JSON.stringify(mockCtx.body, null, 2));
    console.log('\n=== 示例完成 ===');
  }).catch(console.error);
} else {
  console.error('✗ 未找到路由处理函数');
}
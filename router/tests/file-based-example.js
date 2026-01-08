const Router = require('../router');
const fs = require('fs');

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

console.log('=== 文件加载示例 ===\n');

// 创建简单的中间件文件（使用基础字符串连接）
const middlewareContent = 'const config = { level: ["global"], order: 1 };\n' +
'function onRequest(ctx) {\n' +
'  logger.info(ctx.method + " " + ctx.url + " 请求开始");\n' +
'  ctx.state.startTime = Date.now();\n' +
'}\n' +
'function after(ctx) {\n' +
'  if (ctx.body && typeof ctx.body === "object") {\n' +
'    ctx.body.processed = true;\n' +
'  }\n' +
'}\n' +
'function onFinish(ctx) {\n' +
'  const duration = Date.now() - ctx.state.startTime;\n' +
'  logger.info(ctx.method + " " + ctx.url + " 请求结束，耗时 " + duration + "ms");\n' +
'}\n';

fs.writeFileSync('./test-middleware.js', middlewareContent);

// 创建路由文件
const routeContent = 'const config = { method: "GET" };\n' +
'function testRoute() {\n' +
'  return { message: "From file route", timestamp: Date.now() };\n' +
'}\n';

fs.writeFileSync('./test-route.js', routeContent);

// 从文件加载中间件和路由
console.log('1. 从文件加载中间件...');
try {
  router.use('./test-middleware.js');
  console.log('✓ 中间件加载成功');
} catch (error) {
  console.error('✗ 中间件加载失败:', error.message);
  process.exit(1);
}

console.log('\n2. 从文件加载路由...');
try {
  router.loadRouteFile('./test-route.js', 'public');
  console.log('✓ 路由加载成功');
} catch (error) {
  console.error('✗ 路由加载失败:', error.message);
  process.exit(1);
}

// 模拟请求
console.log('\n3. 模拟请求处理...');
const mockCtx = {
  method: 'GET',
  url: '/test-route',
  path: '/test-route',
  status: 200,
  state: {},
  body: null
};

// 获取路由处理函数
const handler = router.getRouteHandler('public', '/test-route', 'GET');

if (handler) {
  handler(mockCtx).then(() => {
    console.log('✓ 请求处理完成');
    console.log('响应结果:', JSON.stringify(mockCtx.body, null, 2));
    
    // 清理临时文件
    fs.unlinkSync('./test-middleware.js');
    fs.unlinkSync('./test-route.js');
    
    console.log('\n=== 示例完成 ===');
  }).catch(error => {
    console.error('✗ 请求处理失败:', error.message);
    // 清理临时文件
    fs.unlinkSync('./test-middleware.js');
    fs.unlinkSync('./test-route.js');
  });
} else {
  console.error('✗ 未找到路由处理函数');
  // 清理临时文件
  fs.unlinkSync('./test-middleware.js');
  fs.unlinkSync('./test-route.js');
}
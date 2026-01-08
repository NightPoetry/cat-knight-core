const Router = require('../router');

// 创建外部工具
const externalTools = {
  logger: {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
  },
  utils: {
    getCurrentTime: () => new Date().toISOString()
  }
};

// 创建路由实例
const router = new Router({
  tools: externalTools
});

// 创建示例中间件文件
const fs = require('fs');
const path = require('path');

// 创建中间件文件
fs.writeFileSync('./logger-middleware.js', 
'const config = {
  level: ["global"],
  order: 1
};

function onRequest(ctx) {
  logger.info(ctx.method + " " + ctx.url + " 请求开始");
  ctx.state.startTime = Date.now();
}

function onFinish(ctx) {
  const duration = Date.now() - ctx.state.startTime;
  logger.info(ctx.method + " " + ctx.url + " " + ctx.status + " 请求完成，耗时 " + duration + "ms");
}'
);

// 创建响应格式化中间件
fs.writeFileSync('./response-formatter.js', 
'const config = {
  level: ["global"],
  order: -2
};

function after(ctx) {
  if (ctx.body && ctx.body.success === undefined) {
    ctx.body = { success: true, data: ctx.body, timestamp: Date.now() };
  }
}'
);

// 创建路由文件
fs.writeFileSync('./hello-route.js', 
'const config = {
  method: "GET",
  description: "Hello World路由"
};

function hello() {
  return { message: "Hello World!", time: utils.getCurrentTime() };
}'
);

console.log('=== 新路由组件示例 ===\n');

// 注册中间件
console.log('1. 注册中间件...');
router
  .use('./logger-middleware.js')
  .use('./response-formatter.js');
console.log('✓ 中间件注册成功\n');

// 加载路由
console.log('2. 加载路由...');
router.loadRouteFile('./hello-route.js', 'public');
console.log('✓ 路由加载成功\n');

// 模拟请求处理
console.log('3. 模拟请求处理...');
const mockCtx = {
  method: 'GET',
  url: '/hello',
  path: '/hello',
  status: 200,
  state: {},
  body: null,
  set: (name, value) => {
    if (!mockCtx.headers) mockCtx.headers = {};
    mockCtx.headers[name] = value;
  },
  headers: {}
};

// 获取路由处理函数
const handler = router.getRouteHandler('public', '/hello', 'GET');

// 执行路由处理
if (handler) {
  handler(mockCtx).then(() => {
    console.log('✓ 请求处理完成');
    console.log('响应结果:', JSON.stringify(mockCtx.body, null, 2));
    
    // 清理临时文件
    [
      './logger-middleware.js',
      './response-formatter.js',
      './hello-route.js'
    ].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    
    console.log('\n=== 示例完成 ===');
  }).catch(error => {
    console.error('✗ 请求处理失败:', error.message);
  });
} else {
  console.error('✗ 未找到路由处理函数');
}
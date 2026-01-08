const RouterLoader = require('./router-loader');

// 创建测试用的外部工具
const externalTools = {
  utils: {
    getCurrentTime: () => new Date().toISOString(),
    formatMessage: (msg) => `[FORMATTED] ${msg}`
  },
  logger: {
    info: (msg) => {
      console.log(`[INFO] ${msg}`);
      return msg;
    },
    error: (msg) => {
      console.error(`[ERROR] ${msg}`);
      return msg;
    }
  },
  process: {
    env: {
      NODE_ENV: 'development'
    }
  }
};

// 创建RouterLoader实例
const routerLoader = new RouterLoader({
  tools: externalTools
});

console.log('=== RouterLoader 测试开始 ===\n');

try {
  // 加载测试路由文件
  console.log('1. 加载测试路由文件...');
  const route = routerLoader.loadRouteFile(
    './test-route.js',
    'public',
    { sandbox: { process: externalTools.process } }
  );
  
  console.log('✓ 路由加载成功！');
  console.log('  - 安全级别:', route.securityLevel);
  console.log('  - 方法:', route.config.method);
  console.log('  - 描述:', route.config.description);
  console.log('  - 限流配置:', JSON.stringify(route.config.rateLimit));
  
  // 测试路由处理函数
  console.log('\n2. 测试路由处理函数...');
  
  // 创建模拟ctx对象
  const mockCtx = {
    request: {},
    response: {},
    state: {},
    body: null
  };
  
  // 执行路由处理函数
  route.handler(mockCtx).then(result => {
    console.log('✓ 路由处理函数执行成功！');
    console.log('  - 返回结果:', JSON.stringify(mockCtx.body, null, 2));
    
    // 测试获取所有路由
    console.log('\n3. 获取所有路由...');
    const routes = routerLoader.getRoutes();
    console.log('✓ 路由列表获取成功！');
    console.log('  - 私有路由数量:', routes.private.length);
    console.log('  - 公开路由数量:', routes.public.length);
    console.log('  - 受保护路由数量:', routes.protected.length);
    
    console.log('\n=== RouterLoader 测试完成 ===');
  }).catch(error => {
    console.error('✗ 路由处理函数执行失败:', error.message);
    console.error(error.stack);
  });
  
} catch (error) {
  console.error('✗ 测试失败:', error.message);
  console.error(error.stack);
}
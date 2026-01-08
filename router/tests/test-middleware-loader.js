const MiddlewareLoader = require('./middleware-loader');

// 创建测试用的外部工具
const externalTools = {
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
  utils: {
    getCurrentTime: () => new Date().toISOString()
  }
};

// 创建MiddlewareLoader实例
const middlewareLoader = new MiddlewareLoader({
  tools: externalTools
});

console.log('=== MiddlewareLoader 测试开始 ===\n');

try {
  // 加载测试中间件文件
  console.log('1. 加载测试中间件文件...');
  const middleware = middlewareLoader.loadMiddlewareFile('./test-middleware.js');
  
  console.log('✓ 中间件加载成功！');
  console.log('  - 名称:', middleware.fileName);
  console.log('  - 级别:', middleware.config.level);
  console.log('  - 顺序:', middleware.config.order);
  console.log('  - 描述:', middleware.config.description);
  
  // 测试中间件排序
  console.log('\n2. 测试中间件排序...');
  
  // 添加更多测试中间件
  const testMiddlewares = {
    'middleware1.js': `const config = { level: ['public'], order: 10 }; function before(ctx) { ctx.mw1 = true; }`,
    'middleware2.js': `const config = { level: ['public'], order: -2 }; function after(ctx) { ctx.mw2 = true; }`,
    'middleware3.js': `const config = { level: ['public'], order: 5 }; function handler(ctx) { ctx.mw3 = true; }`
  };
  
  // 保存并加载测试中间件
  const fs = require('fs');
  Object.keys(testMiddlewares).forEach(fileName => {
    fs.writeFileSync(`./${fileName}`, testMiddlewares[fileName]);
    middlewareLoader.loadMiddlewareFile(`./${fileName}`);
  });
  
  // 组合中间件
  const composed = middlewareLoader.composeMiddlewares('public');
  console.log('✓ 中间件组合成功！');
  
  // 测试中间件执行
  console.log('\n3. 测试中间件执行...');
  
  // 创建模拟ctx对象
  const mockCtx = {
    method: 'GET',
    url: '/test',
    path: '/test',
    state: {},
    set: (name, value) => {
      if (!mockCtx.headers) mockCtx.headers = {};
      mockCtx.headers[name] = value;
    },
    headers: {}
  };
  
  // 执行各阶段中间件
  (async () => {
    // 执行onRequest
    await composed.onRequest.call(middlewareLoader, mockCtx);
    console.log('✓ onRequest 中间件执行成功');
    
    // 执行before
    await composed.before.call(middlewareLoader, mockCtx);
    console.log('✓ before 中间件执行成功');
    
    // 执行after
    await composed.after.call(middlewareLoader, mockCtx);
    console.log('✓ after 中间件执行成功');
    
    // 执行onResponse
    await composed.onResponse.call(middlewareLoader, mockCtx);
    console.log('✓ onResponse 中间件执行成功');
    
    // 执行onError
    await composed.onError.call(middlewareLoader, mockCtx, new Error('Test Error'));
    console.log('✓ onError 中间件执行成功');
    
    // 执行onFinish
    await composed.onFinish.call(middlewareLoader, mockCtx);
    console.log('✓ onFinish 中间件执行成功');
    
    // 验证执行结果
    console.log('\n4. 验证执行结果...');
    console.log('  - startTime:', !!mockCtx.state.startTime);
    console.log('  - middlewareApplied:', !!mockCtx.state.middlewareApplied);
    console.log('  - mw1:', !!mockCtx.mw1);
    console.log('  - mw2:', !!mockCtx.mw2);
    console.log('  - mw3:', !!mockCtx.mw3);
    console.log('  - X-Powered-By:', mockCtx.headers['X-Powered-By']);
    
    // 清理临时文件
    Object.keys(testMiddlewares).forEach(fileName => {
      fs.unlinkSync(`./${fileName}`);
    });
    
    console.log('\n=== MiddlewareLoader 测试完成 ===');
  })().catch(error => {
    console.error('✗ 中间件执行失败:', error.message);
    console.error(error.stack);
  });
  
} catch (error) {
  console.error('✗ 测试失败:', error.message);
  console.error(error.stack);
}
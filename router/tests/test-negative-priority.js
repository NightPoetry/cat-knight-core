// 测试负数优先级的中间件执行顺序
const Router = require('../router');

// 创建路由实例
const router = new Router();

// 用于记录执行顺序
const executionOrder = [];

// 正数优先级中间件
for (let i = 1; i <= 3; i++) {
  router.use({
    config: {
      name: `positive-middleware-${i}`,
      level: ['global'],
      order: i
    },
    async before(ctx) {
      executionOrder.push(`positive-middleware-${i}`);
      console.log(`正数优先级中间件 ${i} 执行`);
    }
  });
}

// 负数优先级中间件
for (let i = -1; i >= -3; i--) {
  router.use({
    config: {
      name: `negative-middleware-${i}`,
      level: ['global'],
      order: i
    },
    async before(ctx) {
      executionOrder.push(`negative-middleware-${i}`);
      console.log(`负数优先级中间件 ${i} 执行`);
    }
  });
}

// 注册测试路由
router.register(
  {
    method: 'GET',
    path: '/test'
  },
  (ctx) => {
    executionOrder.push('route-handler');
    console.log('路由处理函数执行');
    return { message: 'Test completed', executionOrder };
  }
);

// 测试中间件执行顺序
console.log('=== 测试负数优先级中间件执行顺序 ===');
const handler = router.getRouteHandler('public', '/test', 'GET');

if (handler) {
  const ctx = {
    path: '/test',
    method: 'GET',
    status: null,
    body: null
  };
  
  handler(ctx).then(() => {
    console.log('\n=== 执行顺序结果 ===');
    console.log('实际执行顺序:', executionOrder);
    
    // 预期执行顺序：正数优先级按升序，负数优先级按绝对值升序
    const expectedOrder = [
      'positive-middleware-1',
      'positive-middleware-2', 
      'positive-middleware-3',
      'negative-middleware--1', // -1
      'negative-middleware--2', // -2
      'negative-middleware--3', // -3
      'route-handler'
    ];
    
    console.log('预期执行顺序:', expectedOrder);
    
    // 验证执行顺序是否正确
    const isCorrect = JSON.stringify(executionOrder) === JSON.stringify(expectedOrder);
    console.log('\n=== 测试结果 ===');
    console.log('执行顺序是否正确:', isCorrect ? '✓ 正确' : '✗ 错误');
    
    if (!isCorrect) {
      console.log('\n=== 差异分析 ===');
      for (let i = 0; i < Math.max(executionOrder.length, expectedOrder.length); i++) {
        if (executionOrder[i] !== expectedOrder[i]) {
          console.log(`第 ${i+1} 个中间件执行错误: 实际=${executionOrder[i]}, 预期=${expectedOrder[i]}`);
        }
      }
    }
  }).catch(error => {
    console.error('测试执行错误:', error);
  });
} else {
  console.error('获取路由处理函数失败');
}
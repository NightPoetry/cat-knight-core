const Router = require('../router/router');
const SQLiteAdapter = require('../storage/adapters/SQLiteAdapter');
const Entity = require('../storage/Entity');

/**
 * 完整登录系统整合测试
 * 演示core模块的路由、中间件、事务管理和Entity类的完整功能
 */

// 1. 初始化数据库和适配器
// 使用唯一的数据库文件名，避免重复测试冲突
const dbPath = `./test-login-integrated-${Date.now()}.db`;
const adapter = new SQLiteAdapter(dbPath, {
  isolationLevel: 'SERIALIZABLE' // 使用最高隔离级别
});

// 2. 定义实体模型
const userEntityDef = {
  name: 'User',
  fields: {
    id: { rawType: 'str[36][primary]' },
    username: { rawType: 'str[50][unique][not null]' },
    password: { rawType: 'str[255][not null]' },
    email: { rawType: 'str[100][unique][not null]' },
    created_at: { rawType: 'datetime[not null]' },
    updated_at: { rawType: 'datetime[not null]' },
    is_active: { rawType: 'bool[not null]' }
  }
};

// 3. 初始化路由器
const router = new Router({
  tools: {
    adapter: adapter, // 将适配器注入到工具中，以便路由处理函数使用
    Entity: Entity
  }
});

// 4. 创建日志中间件
const loggerMiddleware = {
  config: {
    level: ['global'],
    order: 0,
    enabled: true
  },
  async onRequest(ctx) {
    console.log(`[LOG] ${new Date().toISOString()} - ${ctx.method} ${ctx.path}`);
    ctx.startTime = Date.now();
  },
  async onResponse(ctx) {
    const duration = Date.now() - ctx.startTime;
    console.log(`[LOG] Response - ${ctx.status} ${ctx.body ? JSON.stringify(ctx.body).length : 0} bytes - ${duration}ms`);
  },
  async onError(ctx, error) {
    console.error(`[ERROR] ${new Date().toISOString()} - ${ctx.method} ${ctx.path} - ${error.message}`);
  }
};

// 5. 创建认证中间件
const authMiddleware = {
  config: {
    level: ['protected'],
    order: 1,
    enabled: true
  },
  async before(ctx) {
    const token = ctx.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      ctx.status = 401;
      ctx.body = { success: false, error: { message: 'Authorization token required' } };
      return;
    }
    
    // 验证token
    try {
      const user = await adapter.findOne('User', { id: token });
      
      if (!user) {
        ctx.status = 401;
        ctx.body = { success: false, error: { message: 'Invalid token' } };
        return;
      }
      
      if (!user.is_active) {
        ctx.status = 403;
        ctx.body = { success: false, error: { message: 'User account is disabled' } };
        return;
      }
      
      // 将用户信息存储到上下文中
      ctx.user = user;
    } catch (error) {
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Authentication failed', details: error.message } };
      return;
    }
  }
};

// 6. 注册中间件
router.use(loggerMiddleware);
router.use(authMiddleware);

// 7. 辅助函数
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function hashPassword(password) {
  // 实际应用中应该使用bcrypt或argon2等安全哈希算法
  // 为了测试目的，使用固定的哈希方式
  return `hashed_${password}`;
}

// 8. 注册路由 - 健康检查（公开）
router.register(
  { path: '/health', method: 'GET' },
  async (ctx) => {
    ctx.status = 200;
    ctx.body = { 
      success: true, 
      data: { 
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'login-system'
      } 
    };
  },
  'public'
);

// 9. 注册路由 - 用户注册（公开）
router.register(
  { path: '/api/auth/register', method: 'POST' },
  async (ctx) => {
    const { username, password, email } = ctx.request.body;
    
    // 验证请求参数
    if (!username || !password || !email) {
      ctx.status = 400;
      ctx.body = { success: false, error: { message: 'Missing required fields' } };
      return;
    }
    
    if (username.length < 3 || username.length > 50) {
      ctx.status = 400;
      ctx.body = { success: false, error: { message: 'Username must be between 3 and 50 characters' } };
      return;
    }
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      console.log('[TRANSACTION] Started registration transaction');
      
      // 检查用户是否已存在
      const existingUser = await adapter.findOne('User', { username });
      if (existingUser) {
        await adapter.rollback();
        console.log('[TRANSACTION] Rolled back - username already exists');
        ctx.status = 409;
        ctx.body = { success: false, error: { message: 'Username already exists' } };
        return;
      }
      
      // 检查邮箱是否已存在
      const existingEmail = await adapter.findOne('User', { email });
      if (existingEmail) {
        await adapter.rollback();
        console.log('[TRANSACTION] Rolled back - email already exists');
        ctx.status = 409;
        ctx.body = { success: false, error: { message: 'Email already exists' } };
        return;
      }
      
      // 创建新用户
      const userId = generateUUID();
      const now = new Date();
      
      // 使用Entity类创建用户对象
      const userEntity = new Entity(userEntityDef, {
        id: userId,
        username: username,
        password: hashPassword(password),
        email: email,
        created_at: now,
        updated_at: now,
        is_active: true
      });
      
      // 转换为JSON数据
      const userData = await userEntity.toJSON();
      
      // 插入数据库
      await adapter.insert('User', userData);
      
      // 提交事务
      await adapter.commit();
      console.log('[TRANSACTION] Committed registration transaction');
      
      // 返回响应
      ctx.status = 201;
      ctx.body = { 
        success: true, 
        data: { 
          id: userId, 
          username: username, 
          email: email,
          created_at: userData.created_at,
          is_active: userData.is_active
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      console.error('[TRANSACTION] Rolled back - registration failed:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Registration failed', details: error.message } };
    }
  },
  'public'
);

// 10. 注册路由 - 用户登录（公开）
router.register(
  { path: '/api/auth/login', method: 'POST' },
  async (ctx) => {
    const { username, password } = ctx.request.body;
    
    // 验证请求参数
    if (!username || !password) {
      ctx.status = 400;
      ctx.body = { success: false, error: { message: 'Missing username or password' } };
      return;
    }
    
    try {
      // 查找用户
      const user = await adapter.findOne('User', { username });
      
      if (!user) {
        ctx.status = 401;
        ctx.body = { success: false, error: { message: 'Invalid username or password' } };
        return;
      }
      
      // 验证密码
      const hashedPassword = hashPassword(password);
      if (user.password !== hashedPassword) {
        ctx.status = 401;
        ctx.body = { success: false, error: { message: 'Invalid username or password' } };
        return;
      }
      
      // 检查用户状态
      if (!user.is_active) {
        ctx.status = 403;
        ctx.body = { success: false, error: { message: 'User account is disabled' } };
        return;
      }
      
      // 生成token（使用UUID作为简化的token）
      const token = user.id;
      
      // 返回响应
      ctx.status = 200;
      ctx.body = { 
        success: true, 
        data: { 
          token: token,
          token_type: 'Bearer',
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            is_active: user.is_active
          }
        } 
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Login failed', details: error.message } };
    }
  },
  'public'
);

// 11. 注册路由 - 获取当前用户信息（受保护）
router.register(
  { path: '/api/users/me', method: 'GET' },
  async (ctx) => {
    const { user } = ctx;
    
    // 使用Entity类包装用户数据
    const userEntity = new Entity(userEntityDef, user, true);
    const userData = await userEntity.toJSON();
    
    // 移除敏感信息
    delete userData.password;
    
    ctx.status = 200;
    ctx.body = { 
      success: true, 
      data: userData 
    };
  },
  'protected'
);

// 12. 注册路由 - 更新用户信息（受保护）
router.register(
  { path: '/api/users/me', method: 'PUT' },
  async (ctx) => {
    const { user } = ctx;
    const { email, password, is_active } = ctx.request.body;
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      console.log('[TRANSACTION] Started update transaction');
      
      // 准备更新数据
      const updates = {
        updated_at: new Date()
      };
      
      // 更新邮箱
      if (email) {
        // 检查邮箱是否已被其他用户使用
        const existingEmail = await adapter.findOne('User', { email });
        if (existingEmail && existingEmail.id !== user.id) {
          await adapter.rollback();
          console.log('[TRANSACTION] Rolled back - email already in use');
          ctx.status = 409;
          ctx.body = { success: false, error: { message: 'Email already in use' } };
          return;
        }
        updates.email = email;
      }
      
      // 更新密码
      if (password) {
        updates.password = hashPassword(password);
      }
      
      // 更新用户状态
      if (is_active !== undefined) {
        updates.is_active = is_active;
      }
      
      // 更新数据库
      await adapter.update('User', { id: user.id }, updates);
      
      // 提交事务
      await adapter.commit();
      console.log('[TRANSACTION] Committed update transaction');
      
      // 获取更新后的用户数据
      const updatedUser = await adapter.findOne('User', { id: user.id });
      
      // 返回响应
      ctx.status = 200;
      ctx.body = { 
        success: true, 
        data: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          is_active: updatedUser.is_active,
          updated_at: updatedUser.updated_at
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      console.error('[TRANSACTION] Rolled back - update failed:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Update failed', details: error.message } };
    }
  },
  'protected'
);

// 13. 注册路由 - 删除用户（受保护）
router.register(
  { path: '/api/users/me', method: 'DELETE' },
  async (ctx) => {
    const { user } = ctx;
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      console.log('[TRANSACTION] Started delete transaction');
      
      // 删除用户
      await adapter.db.run(`DELETE FROM "User" WHERE id = ?`, [user.id]);
      
      // 提交事务
      await adapter.commit();
      console.log('[TRANSACTION] Committed delete transaction');
      
      // 返回响应
      ctx.status = 204;
      ctx.body = { success: true, message: 'User deleted successfully' };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      console.error('[TRANSACTION] Rolled back - delete failed:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Delete failed', details: error.message } };
    }
  },
  'protected'
);

// 14. 注册路由 - 获取用户列表（受保护）
router.register(
  { path: '/api/users', method: 'GET' },
  async (ctx) => {
    try {
      // 查找所有用户
      const users = await adapter.find('User', {});
      
      // 转换为安全的响应格式
      const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        is_active: user.is_active,
        created_at: user.created_at
      }));
      
      ctx.status = 200;
      ctx.body = { 
        success: true, 
        data: safeUsers, 
        meta: { total: safeUsers.length } 
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Failed to fetch users', details: error.message } };
    }
  },
  'protected'
);

// 15. 初始化函数
async function init() {
  console.log('=== Login System Integration Test ===');
  
  try {
    // 初始化数据库
    await adapter.init();
    console.log('✓ Database initialized successfully');
    
    // 创建用户表
    await adapter.ensureTable('User', userEntityDef);
    console.log('✓ User table created successfully');
    
    // 显示路由配置
    console.log('\n=== Router Configuration ===');
    const routes = router.getRoutes();
    Object.keys(routes).forEach(level => {
      if (routes[level].length > 0) {
        console.log(`\n${level.toUpperCase()} Routes:`);
        routes[level].forEach(route => {
          console.log(`  - ${route.config.method} ${route.config.path}`);
        });
      }
    });
    
    // 显示中间件配置
    console.log('\n=== Middleware Configuration ===');
    const middlewares = router.getMiddlewares();
    Object.keys(middlewares).forEach(level => {
      if (middlewares[level].length > 0) {
        console.log(`\n${level.toUpperCase()} Middlewares:`);
        middlewares[level].forEach(mw => {
          console.log(`  - ${mw.config.level.join(', ')} (order: ${mw.config.order})`);
        });
      }
    });
    
    // 模拟完整请求流程
    await simulateCompleteFlow();
    
  } catch (error) {
    console.error('✗ Initialization failed:', error);
  } finally {
    await adapter.close();
    console.log('\n=== Test Completed ===');
  }
}

// 16. 模拟完整请求流程
async function simulateCompleteFlow() {
  console.log('\n=== Simulating Complete Request Flow ===');
  
  // 存储token用于后续请求
  let authToken = null;
  
  // 1. 健康检查
  console.log('\n1. Health Check Request:');
  const healthCtx = {
    path: '/health',
    method: 'GET',
    headers: {},
    request: {},
    status: 200,
    body: null
  };
  
  const healthHandler = router.getRouteHandler('public', '/health', 'GET');
  if (healthHandler) {
    await healthHandler(healthCtx);
    console.log('Response:', healthCtx.status, healthCtx.body.success ? '✓' : '✗', healthCtx.body.data.status);
  }
  
  // 2. 用户注册
  console.log('\n2. User Registration:');
  const registerCtx = {
    path: '/api/auth/register',
    method: 'POST',
    headers: {},
    request: {
      body: {
        username: 'integrateduser',
        password: 'password123',
        email: 'integrated@example.com'
      }
    },
    status: 200,
    body: null
  };
  
  const registerHandler = router.getRouteHandler('public', '/api/auth/register', 'POST');
  if (registerHandler) {
    await registerHandler(registerCtx);
    console.log('Response:', registerCtx.status, registerCtx.body.success ? '✓' : '✗', registerCtx.body.data ? 'User created' : registerCtx.body.error?.message);
  }
  
  // 3. 用户登录
  console.log('\n3. User Login:');
  const loginCtx = {
    path: '/api/auth/login',
    method: 'POST',
    headers: {},
    request: {
      body: {
        username: 'integrateduser',
        password: 'password123'
      }
    },
    status: 200,
    body: null
  };
  
  const loginHandler = router.getRouteHandler('public', '/api/auth/login', 'POST');
  if (loginHandler) {
    await loginHandler(loginCtx);
    console.log('Response:', loginCtx.status, loginCtx.body.success ? '✓' : '✗', loginCtx.body.data ? 'Login successful' : loginCtx.body.error?.message);
    
    // 保存token
    if (loginCtx.body.success) {
      authToken = loginCtx.body.data.token;
    }
  }
  
  // 4. 获取用户信息（受保护）
  if (authToken) {
    console.log('\n4. Get User Profile (Protected):');
    const profileCtx = {
      path: '/api/users/me',
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`
      },
      request: {},
      status: 200,
      body: null
    };
    
    const profileHandler = router.getRouteHandler('protected', '/api/users/me', 'GET');
    if (profileHandler) {
      await profileHandler(profileCtx);
      console.log('Response:', profileCtx.status, profileCtx.body.success ? '✓' : '✗', profileCtx.body.data ? 'Profile retrieved' : profileCtx.body.error?.message);
    }
    
    // 5. 更新用户信息（受保护）
    console.log('\n5. Update User Profile (Protected):');
    const updateCtx = {
      path: '/api/users/me',
      method: 'PUT',
      headers: {
        authorization: `Bearer ${authToken}`
      },
      request: {
        body: {
          email: 'updated_integrated@example.com'
        }
      },
      status: 200,
      body: null
    };
    
    const updateHandler = router.getRouteHandler('protected', '/api/users/me', 'PUT');
    if (updateHandler) {
      await updateHandler(updateCtx);
      console.log('Response:', updateCtx.status, updateCtx.body.success ? '✓' : '✗', updateCtx.body.data ? 'Profile updated' : updateCtx.body.error?.message);
    }
    
    // 6. 获取用户列表（受保护）
    console.log('\n6. Get User List (Protected):');
    const usersCtx = {
      path: '/api/users',
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`
      },
      request: {},
      status: 200,
      body: null
    };
    
    const usersHandler = router.getRouteHandler('protected', '/api/users', 'GET');
    if (usersHandler) {
      await usersHandler(usersCtx);
      console.log('Response:', usersCtx.status, usersCtx.body.success ? '✓' : '✗', usersCtx.body.data ? `${usersCtx.body.meta.total} users found` : usersCtx.body.error?.message);
    }
    
    // 7. 删除用户（受保护）
    console.log('\n7. Delete User (Protected):');
    const deleteCtx = {
      path: '/api/users/me',
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${authToken}`
      },
      request: {},
      status: 200,
      body: null
    };
    
    const deleteHandler = router.getRouteHandler('protected', '/api/users/me', 'DELETE');
    if (deleteHandler) {
      await deleteHandler(deleteCtx);
      console.log('Response:', deleteCtx.status, deleteCtx.body.success ? '✓' : '✗', deleteCtx.body.message || deleteCtx.body.error?.message);
    }
  }
  
  // 8. 未授权请求
  console.log('\n8. Unauthorized Request:');
  const unauthorizedCtx = {
    path: '/api/users/me',
    method: 'GET',
    headers: {},
    request: {},
    status: 200,
    body: null
  };
  
  const unauthorizedHandler = router.getRouteHandler('protected', '/api/users/me', 'GET');
  if (unauthorizedHandler) {
    await unauthorizedHandler(unauthorizedCtx);
    console.log('Response:', unauthorizedCtx.status, unauthorizedCtx.body.success ? '✗' : '✓', 'Expected unauthorized response');
  }
}

// 运行初始化
init();
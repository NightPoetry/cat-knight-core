const Router = require('../router/router');
const SQLiteAdapter = require('../storage/adapters/SQLiteAdapter');
const Entity = require('../storage/Entity');

// 1. 初始化数据库和适配器
const dbPath = './test-login.db';
const adapter = new SQLiteAdapter(dbPath);

// 2. 定义用户实体
const userEntityDef = {
  name: 'User',
  fields: {
    id: { rawType: 'str[36]' },
    username: { rawType: 'str[50][unique][not null]' },
    password: { rawType: 'str[255][not null]' },
    email: { rawType: 'str[100][unique][not null]' },
    created_at: { rawType: 'datetime[not null]' }
  }
};

// 3. 初始化路由器
const router = new Router();

// 4. 创建认证中间件
const authMiddleware = {
  config: {
    level: ['protected'],
    order: 1
  },
  async before(ctx) {
    const token = ctx.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      ctx.status = 401;
      ctx.body = { success: false, error: { message: 'Authorization token required' } };
      return;
    }
    
    // 验证token（这里简化处理，实际应该使用JWT等）
    const userId = token;
    const user = await adapter.findOne('User', { id: userId });
    
    if (!user) {
      ctx.status = 401;
      ctx.body = { success: false, error: { message: 'Invalid token' } };
      return;
    }
    
    // 将用户信息存储到上下文中
    ctx.user = user;
  }
};

// 5. 注册中间件
router.use(authMiddleware);

// 6. 注册公共路由 - 注册
router.register(
  { path: '/register', method: 'POST' },
  async (ctx) => {
    const { username, password, email } = ctx.request.body;
    
    if (!username || !password || !email) {
      ctx.status = 400;
      return { success: false, error: { message: 'Missing required fields' } };
    }
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      
      // 检查用户是否已存在
      const existingUser = await adapter.findOne('User', { username });
      if (existingUser) {
        await adapter.rollback();
        ctx.status = 409;
        return { success: false, error: { message: 'Username already exists' } };
      }
      
      // 检查邮箱是否已存在
      const existingEmail = await adapter.findOne('User', { email });
      if (existingEmail) {
        await adapter.rollback();
        ctx.status = 409;
        return { success: false, error: { message: 'Email already exists' } };
      }
      
      // 创建新用户
      const userId = Date.now().toString();
      const newUser = {
        id: userId,
        username,
        password: password, // 实际应该使用密码哈希
        email,
        created_at: new Date().toISOString()
      };
      
      await adapter.insert('User', newUser);
      
      // 提交事务
      await adapter.commit();
      
      ctx.status = 201;
      return { 
        success: true, 
        data: { 
          id: userId, 
          username, 
          email 
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      ctx.status = 500;
      return { success: false, error: { message: 'Registration failed', details: error.message } };
    }
  },
  'public'
);

// 7. 注册公共路由 - 登录
router.register(
  { path: '/login', method: 'POST' },
  async (ctx) => {
    const { username, password } = ctx.request.body;
    
    if (!username || !password) {
      ctx.status = 400;
      return { success: false, error: { message: 'Missing username or password' } };
    }
    
    try {
      // 查找用户
      const user = await adapter.findOne('User', { username });
      
      if (!user || user.password !== password) {
        ctx.status = 401;
        return { success: false, error: { message: 'Invalid username or password' } };
      }
      
      // 生成token（简化处理，实际应该使用JWT等）
      const token = user.id;
      
      return { 
        success: true, 
        data: { 
          token, 
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          } 
        } 
      };
    } catch (error) {
      ctx.status = 500;
      return { success: false, error: { message: 'Login failed', details: error.message } };
    }
  },
  'public'
);

// 8. 注册受保护路由 - 获取当前用户信息
router.register(
  { path: '/profile', method: 'GET' },
  async (ctx) => {
    const { user } = ctx;
    
    return { 
      success: true, 
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      } 
    };
  },
  'protected'
);

// 9. 注册受保护路由 - 更新用户信息
router.register(
  { path: '/profile', method: 'PUT' },
  async (ctx) => {
    const { user } = ctx;
    const { email } = ctx.request.body;
    
    if (!email) {
      ctx.status = 400;
      return { success: false, error: { message: 'Missing email' } };
    }
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      
      // 检查邮箱是否已被其他用户使用
      const existingEmail = await adapter.findOne('User', { email });
      if (existingEmail && existingEmail.id !== user.id) {
        await adapter.rollback();
        ctx.status = 409;
        return { success: false, error: { message: 'Email already in use' } };
      }
      
      // 更新用户信息
      await adapter.update('User', { id: user.id }, { email });
      
      // 提交事务
      await adapter.commit();
      
      return { 
        success: true, 
        data: {
          id: user.id,
          username: user.username,
          email: email
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      ctx.status = 500;
      return { success: false, error: { message: 'Update failed', details: error.message } };
    }
  },
  'protected'
);

// 10. 初始化函数
async function init() {
  try {
    // 初始化数据库
    await adapter.init();
    
    // 创建用户表
    await adapter.ensureTable('User', userEntityDef);
    
    console.log('Database initialized successfully');
    console.log('Router initialized with routes:');
    console.log(JSON.stringify(router.getRoutes(), null, 2));
    
    // 模拟请求处理
    await simulateRequests();
  } catch (error) {
    console.error('Initialization failed:', error);
  } finally {
    await adapter.close();
  }
}

// 11. 模拟请求处理函数
async function simulateRequests() {
  console.log('\n--- Simulating Requests ---');
  
  // 模拟注册请求
  console.log('\n1. Register Request:');
  const registerCtx = {
    path: '/register',
    method: 'POST',
    request: {
      body: {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      }
    },
    status: 200,
    body: null
  };
  
  const registerHandler = router.getRouteHandler('public', '/register', 'POST');
  if (registerHandler) {
    await registerHandler(registerCtx);
    console.log('Response:', registerCtx.status, registerCtx.body);
  }
  
  // 模拟登录请求
  console.log('\n2. Login Request:');
  const loginCtx = {
    path: '/login',
    method: 'POST',
    request: {
      body: {
        username: 'testuser',
        password: 'password123'
      }
    },
    status: 200,
    body: null
  };
  
  const loginHandler = router.getRouteHandler('public', '/login', 'POST');
  if (loginHandler) {
    await loginHandler(loginCtx);
    console.log('Response:', loginCtx.status, loginCtx.body);
    
    // 获取token用于后续请求
    const token = loginCtx.body.data.token;
    
    // 模拟获取用户信息请求（受保护）
    console.log('\n3. Get Profile Request (Protected):');
    const profileCtx = {
      path: '/profile',
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      },
      status: 200,
      body: null
    };
    
    const profileHandler = router.getRouteHandler('protected', '/profile', 'GET');
    if (profileHandler) {
      await profileHandler(profileCtx);
      console.log('Response:', profileCtx.status, profileCtx.body);
    }
    
    // 模拟更新用户信息请求（受保护）
    console.log('\n4. Update Profile Request (Protected):');
    const updateCtx = {
      path: '/profile',
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      },
      request: {
        body: {
          email: 'updated@example.com'
        }
      },
      status: 200,
      body: null
    };
    
    const updateHandler = router.getRouteHandler('protected', '/profile', 'PUT');
    if (updateHandler) {
      await updateHandler(updateCtx);
      console.log('Response:', updateCtx.status, updateCtx.body);
    }
    
    // 模拟无效token请求（受保护）
    console.log('\n5. Invalid Token Request (Protected):');
    const invalidCtx = {
      path: '/profile',
      method: 'GET',
      headers: {
        authorization: 'Bearer invalid_token'
      },
      status: 200,
      body: null
    };
    
    if (profileHandler) {
      await profileHandler(invalidCtx);
      console.log('Response:', invalidCtx.status, invalidCtx.body);
    }
  }
}

// 运行初始化
init();
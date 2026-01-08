const Router = require('../router/router');
const SQLiteAdapter = require('../storage/adapters/SQLiteAdapter');
const Entity = require('../storage/Entity');

// 1. 初始化数据库和适配器
const dbPath = './test-login-advanced.db';
const adapter = new SQLiteAdapter(dbPath);

// 2. 定义用户实体
const userEntityDef = {
  name: 'User',
  fields: {
    id: { rawType: 'str[36]' },
    username: { rawType: 'str[50][unique][not null]' },
    password: { rawType: 'str[255][not null]' },
    email: { rawType: 'str[100][unique][not null]' },
    created_at: { rawType: 'datetime[not null]' },
    updated_at: { rawType: 'datetime[not null]' }
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
    
    // 验证token
    try {
      const user = await adapter.findOne('User', { id: token });
      
      if (!user) {
        ctx.status = 401;
        ctx.body = { success: false, error: { message: 'Invalid token' } };
        return;
      }
      
      // 将用户信息存储到上下文中
      ctx.user = user;
    } catch (error) {
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Authentication failed', details: error.message } };
    }
  }
};

// 5. 创建日志中间件
const loggerMiddleware = {
  config: {
    level: ['global'],
    order: 0
  },
  async onRequest(ctx) {
    console.log(`[LOG] ${new Date().toISOString()} - ${ctx.method} ${ctx.path}`);
  },
  async onResponse(ctx) {
    console.log(`[LOG] Response - ${ctx.status} ${ctx.body ? JSON.stringify(ctx.body).length : 0} bytes`);
  }
};

// 6. 注册中间件
router.use(authMiddleware);
router.use(loggerMiddleware);

// 7. 辅助函数：生成UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 8. 辅助函数：哈希密码（简化处理，实际应使用bcrypt等）
function hashPassword(password) {
  // 这里简化处理，实际应该使用bcrypt等安全算法
  return `hashed_${password}`;
}

// 9. 注册公共路由 - 注册
router.register(
  { path: '/register', method: 'POST' },
  async (ctx) => {
    const { username, password, email } = ctx.request.body;
    
    if (!username || !password || !email) {
      ctx.status = 400;
      ctx.body = { success: false, error: { message: 'Missing required fields' } };
      return;
    }
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      
      // 检查用户是否已存在
      const existingUser = await adapter.findOne('User', { username });
      if (existingUser) {
        await adapter.rollback();
        ctx.status = 409;
        ctx.body = { success: false, error: { message: 'Username already exists' } };
        return;
      }
      
      // 检查邮箱是否已存在
      const existingEmail = await adapter.findOne('User', { email });
      if (existingEmail) {
        await adapter.rollback();
        ctx.status = 409;
        ctx.body = { success: false, error: { message: 'Email already exists' } };
        return;
      }
      
      // 创建新用户实体
      const userId = generateUUID();
      const now = new Date();
      
      // 使用Entity类处理数据
      const userEntity = new Entity(userEntityDef, {
        id: userId,
        username: username,
        password: hashPassword(password),
        email: email,
        created_at: now,
        updated_at: now
      });
      
      // 转换为JSON数据进行存储
      const userData = await userEntity.toJSON();
      
      // 插入数据库
      await adapter.insert('User', userData);
      
      // 提交事务
      await adapter.commit();
      
      ctx.status = 201;
      ctx.body = { 
        success: true, 
        data: { 
          id: userId, 
          username: username, 
          email: email,
          created_at: userData.created_at
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Registration failed', details: error.message } };
    }
  },
  'public'
);

// 10. 注册公共路由 - 登录
router.register(
  { path: '/login', method: 'POST' },
  async (ctx) => {
    const { username, password } = ctx.request.body;
    
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
      
      // 生成token（使用UUID作为简化的token）
      const token = user.id;
      
      ctx.body = { 
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
      ctx.body = { success: false, error: { message: 'Login failed', details: error.message } };
    }
  },
  'public'
);

// 11. 注册受保护路由 - 获取当前用户信息
router.register(
  { path: '/profile', method: 'GET' },
  async (ctx) => {
    const { user } = ctx;
    
    // 使用Entity类包装用户数据
    const userEntity = new Entity(userEntityDef, user, true);
    const userData = await userEntity.toJSON();
    
    // 移除敏感信息
    delete userData.password;
    
    ctx.body = { 
      success: true, 
      data: userData
    };
  },
  'protected'
);

// 12. 注册受保护路由 - 更新用户信息
router.register(
  { path: '/profile', method: 'PUT' },
  async (ctx) => {
    const { user } = ctx;
    const { email, password } = ctx.request.body;
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      
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
      
      // 更新数据库
      await adapter.update('User', { id: user.id }, updates);
      
      // 提交事务
      await adapter.commit();
      
      // 获取更新后的用户数据
      const updatedUser = await adapter.findOne('User', { id: user.id });
      
      ctx.body = { 
        success: true, 
        data: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          updated_at: updatedUser.updated_at
        } 
      };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Update failed', details: error.message } };
    }
  },
  'protected'
);

// 13. 注册受保护路由 - 删除用户
router.register(
  { path: '/profile', method: 'DELETE' },
  async (ctx) => {
    const { user } = ctx;
    
    try {
      // 开始事务
      await adapter.beginTransaction();
      
      // 删除用户
      await adapter.db.run(`DELETE FROM "User" WHERE id = ?`, [user.id]);
      
      // 提交事务
      await adapter.commit();
      
      ctx.status = 204;
      ctx.body = { success: true, message: 'User deleted successfully' };
    } catch (error) {
      // 回滚事务
      await adapter.rollback();
      ctx.status = 500;
      ctx.body = { success: false, error: { message: 'Delete failed', details: error.message } };
    }
  },
  'protected'
);

// 14. 初始化函数
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

// 15. 模拟请求处理函数
async function simulateRequests() {
  console.log('\n--- Simulating Advanced Requests ---');
  
  // 模拟注册请求
  console.log('\n1. Register Request:');
  const registerCtx = {
    path: '/register',
    method: 'POST',
    request: {
      body: {
        username: 'advanceduser',
        password: 'password123',
        email: 'advanced@example.com'
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
  
  // 模拟重复注册请求
  console.log('\n2. Duplicate Register Request:');
  const duplicateRegisterCtx = {
    path: '/register',
    method: 'POST',
    request: {
      body: {
        username: 'advanceduser',
        password: 'password123',
        email: 'advanced2@example.com'
      }
    },
    status: 200,
    body: null
  };
  
  if (registerHandler) {
    await registerHandler(duplicateRegisterCtx);
    console.log('Response:', duplicateRegisterCtx.status, duplicateRegisterCtx.body);
  }
  
  // 模拟登录请求
  console.log('\n3. Login Request:');
  const loginCtx = {
    path: '/login',
    method: 'POST',
    request: {
      body: {
        username: 'advanceduser',
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
    console.log('\n4. Get Profile Request (Protected):');
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
    console.log('\n5. Update Profile Request (Protected):');
    const updateCtx = {
      path: '/profile',
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`
      },
      request: {
        body: {
          email: 'updated_advanced@example.com',
          password: 'newpassword456'
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
    
    // 模拟使用旧密码登录（验证密码更新）
    console.log('\n6. Login with Old Password:');
    const oldPasswordLoginCtx = {
      path: '/login',
      method: 'POST',
      request: {
        body: {
          username: 'advanceduser',
          password: 'password123'
        }
      },
      status: 200,
      body: null
    };
    
    if (loginHandler) {
      await loginHandler(oldPasswordLoginCtx);
      console.log('Response:', oldPasswordLoginCtx.status, oldPasswordLoginCtx.body);
    }
    
    // 模拟使用新密码登录
    console.log('\n7. Login with New Password:');
    const newPasswordLoginCtx = {
      path: '/login',
      method: 'POST',
      request: {
        body: {
          username: 'advanceduser',
          password: 'newpassword456'
        }
      },
      status: 200,
      body: null
    };
    
    if (loginHandler) {
      await loginHandler(newPasswordLoginCtx);
      console.log('Response:', newPasswordLoginCtx.status, newPasswordLoginCtx.body);
      
      const newToken = newPasswordLoginCtx.body.data.token;
      
      // 模拟删除用户请求（受保护）
      console.log('\n8. Delete Profile Request (Protected):');
      const deleteCtx = {
        path: '/profile',
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${newToken}`
        },
        status: 200,
        body: null
      };
      
      const deleteHandler = router.getRouteHandler('protected', '/profile', 'DELETE');
      if (deleteHandler) {
        await deleteHandler(deleteCtx);
        console.log('Response:', deleteCtx.status, deleteCtx.body);
      }
    }
    
    // 模拟未授权请求（无token）
    console.log('\n9. Unauthorized Request (No Token):');
    const unauthorizedCtx = {
      path: '/profile',
      method: 'GET',
      headers: {},
      status: 200,
      body: null
    };
    
    if (profileHandler) {
      await profileHandler(unauthorizedCtx);
      console.log('Response:', unauthorizedCtx.status, unauthorizedCtx.body);
    }
  }
}

// 运行初始化
init();
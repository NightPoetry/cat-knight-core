// 错误处理中间件

/**
 * 错误处理中间件
 * 统一处理应用中的错误，确保返回一致的错误格式
 */
const config = {
  name: 'error-handler',
  level: ['global'],
  order: -1, // 负数优先级，确保最后执行
  enabled: true,
  exclude: [], // 不排除任何路径
  options: {
    showStack: process.env.NODE_ENV === 'development', // 开发环境显示堆栈信息
    format: 'json', // 错误格式：json, html
    defaultStatus: 500, // 默认错误状态码
    defaultMessage: 'Internal Server Error', // 默认错误消息
    errorCodes: {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      500: 'Internal Server Error'
    } // 错误码映射
  }
};

/**
 * 格式化错误响应
 * @param {Error} error - 错误对象
 * @param {Object} ctx - Koa上下文
 * @returns {Object} - 格式化后的错误响应
 */
function formatErrorResponse(error, ctx) {
  const status = error.status || error.statusCode || config.options.defaultStatus;
  const message = error.message || config.options.errorCodes[status] || config.options.defaultMessage;

  const errorResponse = {
    success: false,
    error: {
      message: message,
      code: status
    }
  };

  // 在开发环境中显示详细错误信息
  if (config.options.showStack) {
    errorResponse.error.stack = error.stack;
    errorResponse.error.details = error.details || {};
  }

  return errorResponse;
}

/**
 * 错误处理中间件的onError钩子
 * @param {Object} ctx - Koa上下文
 * @param {Error} error - 错误对象
 */
async function onError(ctx, error) {
  // 确保错误被捕获，防止应用崩溃
  try {
    // 格式化错误响应
    const errorResponse = formatErrorResponse(error, ctx);

    // 设置状态码和响应体
    ctx.status = errorResponse.error.code;
    ctx.body = errorResponse;

    // 确保响应类型正确
    if (config.options.format === 'json') {
      ctx.set('Content-Type', 'application/json');
    } else {
      // HTML格式的错误响应，简单实现
      ctx.set('Content-Type', 'text/html');
      ctx.body = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error ${errorResponse.error.code}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 50px; text-align: center; }
            h1 { color: #e74c3c; }
            p { color: #333; }
            .error-details { margin-top: 20px; text-align: left; background: #f8f9fa; padding: 20px; border-radius: 5px; }
          </style>
        </head>
        <body>
          <h1>Error ${errorResponse.error.code}</h1>
          <p>${errorResponse.error.message}</p>
          ${config.options.showStack && errorResponse.error.stack ? `<div class="error-details"><pre>${errorResponse.error.stack}</pre></div>` : ''}
        </body>
        </html>
      `;
    }
  } catch (err) {
    // 防止错误处理过程中再次出错
    console.error('Error in error handler:', err);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: {
        message: 'Internal Server Error',
        code: 500
      }
    };
  }
}

/**
 * 自定义错误类，用于创建带有状态码和详细信息的错误
 */
class AppError extends Error {
  constructor(message, status = 500, details = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.statusCode = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 导出中间件
exports.config = config;
exports.onError = onError;
exports.AppError = AppError;
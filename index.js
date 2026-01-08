// Core module entry point

// Export router functionality
const Router = require('./router/router');

// Export storage functionality
const Entity = require('./storage/Entity');
const { DBType, DBNumber, DBString, DBBool, DBDateTime } = require('./storage/DataTypes');
const SQLiteAdapter = require('./storage/adapters/SQLiteAdapter');
const JSONAdapter = require('./storage/adapters/JSONAdapter');

module.exports = {
  // Router
  Router,
  
  // Storage
  Entity,
  DBType,
  DBNumber,
  DBString,
  DBBool,
  DBDateTime,
  SQLiteAdapter,
  JSONAdapter
};

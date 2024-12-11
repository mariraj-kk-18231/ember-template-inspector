const FileNamePlugin = require('./file-name-plugin');

module.exports = {
  buildPlugin(params) {
    return FileNamePlugin(params)
  }
};

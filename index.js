'use strict';

const fs = require('fs');
const path = require('path');
const launch = require('launch-editor');

const processDir = process.cwd();
const preferencePath = path.join(processDir, 'template-inspectorrc.json');
const isConfigFileExists = fs.existsSync(preferencePath);

let serverUrl, editor;
let isInspectorEnabled = true;

function validateAndLoadConfig() {
  if (isConfigFileExists) {
    let content = fs.readFileSync(preferencePath, 'utf-8');
    let inspectorOptions = JSON.parse(content);
    editor = inspectorOptions.editor;
    isInspectorEnabled = inspectorOptions.enabled;
  }
}

const fileLocationHash = {};
let appOrAddonIndex = 1;

module.exports = {
  name: require('./package').name,

  serverMiddleware(config) {
    if (!isInspectorEnabled) {
      return;
    }

    this.setupAPI(config);
  },

  setupAPI({ app, options }) {
    let protocol = options.ssl === true ? 'https' : 'http';
    serverUrl = `${protocol}://localhost:${options.port}`;

    app.get('/openfile', (req, res, next) => {
      let filePath;
      let { file } = req.query;
      let [appOrAddon, fileIndex, line, column] = file.split(':');
      let { moduleRootPath, files } = fileLocationHash[appOrAddon];

      if (files) {
        let fileName = files[fileIndex];
        filePath = path.join(moduleRootPath, fileName);
      }

      try {
        if (fs.existsSync(filePath)) {
          // If editor is specified in the config, it will try to load it first.
          // Else, it will load any running editor.
          // If there is no running editor, it will fallback to process.env.EDITOR
          launch(`${filePath}:${line}:${column}`, editor);

          res.send('File opened');
        } else {
          next(new Error('File not found'));
        }
      } catch (exception) {
        next(exception);
      }
    });

    app.get('/fileinfo', (req, res) => {
      res.status(200).json({ file_location_hash: fileLocationHash });
    });
  },

  testemMiddleware(app, options) {
    this.setupAPI({ app, options });
  },

  _setupPreprocessorRegistry(app) {
    if (!isInspectorEnabled) {
      return;
    }
    let { registry } = app;
    let { parent } = this;
    let { root, pkg } = parent;
    let { keywords = [] } = pkg;
    let emberApp = this._findHost();
    let { options } = emberApp;
    let moduleRootPath, moduleName;

    if (options.name === app.name && options.trees.app === 'tests/dummy/app') {
      moduleRootPath = `${processDir}/tests/dummy/app`;
      moduleName = 'dummy';
    } else {
      moduleRootPath = keywords.includes('ember-addon')
        ? `${root}/addon`
        : `${root}/app`;
      moduleName =
        typeof parent.name === 'function' ? parent.name() : parent.name;
    }

    let files = fs
      .readdirSync(moduleRootPath, { recursive: true })
      .filter((path) => path.endsWith('.hbs'));

    fileLocationHash[appOrAddonIndex] = {
      moduleName,
      moduleRootPath,
      files,
    };

    registry.add('htmlbars-ast-plugin', {
      name: 'file-name-plugin',
      plugin: {
        _parallelBabel: {
          requireFile: __dirname + '/lib/build-plugin',
          buildUsing: 'buildPlugin',
          params: {
            moduleName,
            appOrAddonIndex: appOrAddonIndex++,
            files
          }
        },
      },
      baseDir() {
        return __dirname;
      },
    });
  },

  included(app) {
    this._super.included.apply(this, arguments);
    let _app = this._findHost();

    if (_app.env === 'development' && !process.env.CI) {
      validateAndLoadConfig();
    } else {
      isInspectorEnabled = _app.env === 'test' && this.isDevelopingAddon();
    }
    this._setupPreprocessorRegistry(app);
  },

  treeFor() {
    if (!isInspectorEnabled) {
      return;
    }

    return this._super.treeFor.call(this, ...arguments);
  },
  contentFor(type) {
    if (type === 'head' && isInspectorEnabled && serverUrl) {
      return `<script>window.emberTemplateInspector = { serverUrl: '${serverUrl}' }</script>`;
    }
  },
};

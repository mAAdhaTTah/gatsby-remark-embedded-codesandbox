'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var fs = require('fs');
var path = require('path');
var LZString = require('lz-string');
var normalizePath = require('normalize-path');
var map = require('unist-util-map');
var queryString = require('query-string');

var DEFAULT_PROTOCOL = 'embedded-codesandbox://';
var DEFAULT_EMBED_OPTIONS = {
  view: 'preview',
  hidenavigation: 1
};
var DEFAULT_GET_IFRAME = function DEFAULT_GET_IFRAME(url) {
  return '<iframe src="' + url + '" class="embedded-codesandbox" sandbox="allow-modals allow-forms allow-popups allow-scripts allow-same-origin"></iframe>';
};

// Matches compression used in Babel and CodeSandbox REPLs
// https://github.com/babel/website/blob/master/js/repl/UriUtils.js
var compress = function compress(string) {
  return LZString.compressToBase64(string).replace(/\+/g, '-') // Convert '+' to '-'
  .replace(/\//g, '_') // Convert '/' to '_'
  .replace(/=+$/, '');
}; // Remove ending '='

var getFiles = function getFiles(baseDir, dir, files) {
  fs.readdirSync(dir).forEach(function (file) {
    var subDir = path.join(dir, file);
    if (fs.lstatSync(subDir).isDirectory()) {
      getFiles(baseDir, subDir, files);
    } else {
      var filePath = path.join(dir, file);
      files.push(filePath.replace(baseDir + '/', ''));
    }
  });
};

module.exports = function (_ref, _ref2) {
  var markdownAST = _ref.markdownAST;
  var rootDirectory = _ref2.directory,
      _ref2$protocol = _ref2.protocol,
      protocol = _ref2$protocol === undefined ? DEFAULT_PROTOCOL : _ref2$protocol,
      _ref2$embedOptions = _ref2.embedOptions,
      embedOptions = _ref2$embedOptions === undefined ? DEFAULT_EMBED_OPTIONS : _ref2$embedOptions,
      _ref2$getIframe = _ref2.getIframe,
      getIframe = _ref2$getIframe === undefined ? DEFAULT_GET_IFRAME : _ref2$getIframe;

  if (!rootDirectory) {
    throw Error('Required option "directory" not specified');
  } else if (!fs.existsSync(rootDirectory)) {
    throw Error('Cannot find directory "' + rootDirectory + '"');
  } else if (!rootDirectory.endsWith('/')) {
    rootDirectory += '/';
  }

  var getDirectoryPath = function getDirectoryPath(url) {
    var directoryPath = url.replace(protocol, '');
    var fullPath = path.join(rootDirectory, directoryPath);
    return normalizePath(fullPath);
  };

  var getFilesList = function getFilesList(directory) {
    var packageJsonFound = false;
    var folderFiles = [];
    var sandboxFiles = [];
    getFiles(directory, directory, folderFiles);

    folderFiles
    // we ignore the package.json file as it will
    // be handled separately
    .filter(function (file) {
      return file !== 'package.json';
    }).map(function (file) {
      var fullFilePath = path.resolve(directory, file);
      var content = fs.readFileSync(fullFilePath, 'utf-8');
      sandboxFiles.push({
        name: file,
        content: content
      });
    });

    var workingDir = directory;
    while (!packageJsonFound) {
      // first read all files in the folder and look
      // for a package.json there
      var files = fs.readdirSync(workingDir);
      var packageJson = getPackageJsonFile(files);
      if (packageJson) {
        var fullFilePath = path.resolve(workingDir, 'package.json');
        var content = fs.readFileSync(fullFilePath, 'utf-8');
        sandboxFiles.push({
          name: 'package.json',
          content: content
        });
        packageJsonFound = true;
        // if root folder is reached, use a fallback default
        // value as content, to ensure the sandbox is always working
      } else if (path.resolve(workingDir) === path.resolve(rootDirectory)) {
        sandboxFiles.push({
          name: 'package.json',
          content: '{ "name": "example" }'
        });
        packageJsonFound = true;
        // if not present, work up the folders
      } else {
        workingDir = path.join(workingDir, '..');
      }
    }

    return sandboxFiles;
  };

  var getPackageJsonFile = function getPackageJsonFile(fileList) {
    var found = fileList.filter(function (name) {
      return name === 'package.json';
    });
    return found.length > null;
  };

  var createParams = function createParams(files) {
    var filesObj = files.reduce(function (prev, current) {
      // parse package.json first
      if (current.name === 'package.json') {
        prev[current.name] = { content: JSON.parse(current.content) };
      } else {
        prev[current.name] = { content: current.content };
      }
      return prev;
    }, {});
    var params = {
      files: filesObj
    };

    return compress(JSON.stringify(params));
  };

  var getUrlParts = function getUrlParts(url) {
    var splitUrl = url.split('?');
    return {
      base: splitUrl[0],
      query: queryString.parse(splitUrl[1])
    };
  };

  var convertNodeToEmbedded = function convertNodeToEmbedded(node, params) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

    delete node.children;
    delete node.position;
    delete node.title;
    delete node.url;

    // merge the overriding options with the plugin one
    var mergedOptions = _extends({}, embedOptions, options);
    var encodedEmbedOptions = encodeURIComponent(queryString.stringify(mergedOptions));
    var sandboxUrl = 'https://codesandbox.io/api/v1/sandboxes/define?embed=1&parameters=' + params + '&query=' + encodedEmbedOptions;
    var embedded = getIframe(sandboxUrl);

    node.type = 'html';
    node.value = embedded;
  };

  map(markdownAST, function (node, index, parent) {
    if (node.type === 'link' && node.url.startsWith(protocol)) {
      // split the url in base and query to allow user
      // to customise embedding options on a per-node basis
      var url = getUrlParts(node.url);
      // get all files in the folder and generate
      // the embeddeing parameters
      var dir = getDirectoryPath(url.base);
      var files = getFilesList(dir);
      var params = createParams(files);
      convertNodeToEmbedded(node, params, url.query);
    }

    return node;
  });

  return markdownAST;
};

/* (c)  oblong industries */

/* global __current_source_mapping_url__ */
/* global __current_script_name__ */
/* global read */

// Source-mapping support for Growroom applications, intended to 
// help map errors from a line number in a webpack-compiled bundle 
// back to a line number in the author's original source file.  

//  require()ing this will install some
// functions and properties into the global namespace.

let SourceMapConsumer = require('source-map').SourceMapConsumer;

// V8 locks down the prototypes of several internal objects like CallSite
// (which is the constructor for the stack frames we manipulate).
// Unfortunately if you try to do something like:
//     Object.getPrototypeOf(frame).toString.call(someOtherObject)
// as we would want to do below, really, really bad things happen (you
// get what's called an "illegal access" error and if you don't
// swallow that you get a lovely ~450 line spew from v8).  Thus, we
// copy-paste the function (from v8's messages.js) here.  So it goes.
function CallSiteToString() {
  var fileName;
  var fileLocation = "";
  if (this.isNative()) {
    fileLocation = "native";
  } else {
    fileName = this.getScriptNameOrSourceURL();
    if (!fileName && this.isEval()) {
      fileLocation = this.getEvalOrigin();
      fileLocation += ", ";  // Expecting source position to follow.
    }

    if (fileName) {
      fileLocation += fileName;
    } else {
      // Source code does not originate from a file and is not native, but we
      // can still get the source position inside the source string, e.g. in
      // an eval string.
      fileLocation += "<anonymous>";
    }
    var lineNumber = this.getLineNumber();
    if (lineNumber !== null) {
      fileLocation += ":" + lineNumber;
      var columnNumber = this.getColumnNumber();
      if (columnNumber) {
        fileLocation += ":" + columnNumber;
      }
    }
  }

  var line = "";
  var functionName = this.getFunctionName();
  var addSuffix = true;
  var isConstructor = this.isConstructor();
  var isMethodCall = !(this.isToplevel() || isConstructor);
  if (isMethodCall) {
    var typeName = this.getTypeName();
    var methodName = this.getMethodName();
    if (functionName) {
      if (typeName && functionName.indexOf(typeName) !== 0) {
        line += typeName + ".";
      }
      line += functionName;
      if (methodName && functionName.indexOf('.' + methodName) !==
          functionName.length - methodName.length - 1) {
        line += " [as " + methodName + "]";
      }
    } else {
      line += typeName + "." + (methodName || "<anonymous>");
    }
  } else if (isConstructor) {
    line += "new " + (functionName || "<anonymous>");
  } else if (functionName) {
    line += functionName;
  } else {
    line += fileLocation;
    addSuffix = false;
  }
  if (addSuffix) {
    line += " (" + fileLocation + ")";
  }
  return line;
}

global.Error.prepareStackTrace = (error, stack) => {
  let source_map;
  if (__current_script_name__ && __current_source_mapping_url__) {
    // The sourceMappingURL webpack writes is relative to the the
    // script's path.
    let path_segments = __current_script_name__.split('/');
    let nsegs = path_segments.length;
    path_segments[nsegs - 1] = __current_source_mapping_url__;
    let source_map_path = path_segments.join('/');
    try {
      let src = read(source_map_path);
      source_map = JSON.parse(src);
    } catch (e) {
      return error.stack + '\n    (error reading source map)';
    }
  } else {
    return error.stack;
  }

  // *any* uncaught errors in the block below would completely wreck
  // the stack trace.
  try {
    let smc = new SourceMapConsumer(source_map);
    let stack_trace = error;
    for (let frame of stack) {
      if (frame.getFileName() === __current_script_name__) {
        let orig = smc.originalPositionFor({
          line: frame.getLineNumber(),
          column: frame.getColumnNumber()
        });
        let mapped_frame = {};
        if (orig.source !== null) {
          // V8 locks down the prototypes of some internal objects,
          // like CallSite (the constructor for `frame`), so we resort
          // to some shenanigans.
          let frame_proto = Object.getPrototypeOf(frame);
          const tostring_props = [ // properties used in CallSiteToString
            'isNative', 'isEval', 'getEvalOrigin', 'getFunctionName',
            'isConstructor', 'isToplevel', 'getTypeName', 'getMethodName'
          ];
          for (let prop of Object.getOwnPropertyNames(frame_proto)) {
            if (tostring_props.indexOf(prop) >= 0) {
              mapped_frame[prop] = frame[prop].bind(frame);
            } else {
              mapped_frame[prop] = frame[prop];
            }
          }
          // Demunge the name of the tmp file created by JSExecutor to hold
          // the original script + the appendix
          let matches = orig.source.match(/^(.*)\.tmp\.js$/);
          if (matches) {
            orig.source = matches[1];
          }
          mapped_frame.getScriptNameOrSourceURL = () => orig.source;
          mapped_frame.getLineNumber = () => orig.line;
          mapped_frame.getColumnNumber = () => orig.column;
          mapped_frame.toString = CallSiteToString;
        } else {
          mapped_frame = frame;
        }
        stack_trace += '\n  at ' + mapped_frame.toString();
      }
    }
    return stack_trace;
  } catch (e) {
    // The unfortunate thing about errors produced in the function
    // that produces stack traces is that they themselves often lack
    // stack traces, so `e.toString()` is not really useful to add
    // here.
    return error.stack +
      '\n    (error augmenting stack trace with source mappings)';
  }
};


const fs = require("fs");
const path = require("path");
const slash = require("slash");
const del = require("del");
const yaml = require("js-yaml");
const browserSync = require("browser-sync");
const { argv } = require("yargs");
const { src, dest, series, parallel, watch, lastRun } = require("gulp");
const noop = require("gulp-noop");
const sourcemaps = require("gulp-sourcemaps");
const concat = require("gulp-concat");
const cached = require("gulp-cached");
const remember = require("gulp-remember");
const sass = require("gulp-sass");
const sassPartialsImported = require("gulp-sass-partials-imported");
const minify = require("gulp-clean-css");
const prefix = require("gulp-autoprefixer");
const imagemin = require("gulp-imagemin");
const uglify = require("gulp-uglify");
const jshint = require("gulp-jshint");
const htmlmin = require("gulp-htmlmin");
const babel = require("gulp-babel");

if (!fs.existsSync("work.yml")) {
  throw new Error("Please create work.yml file in current path");
}

const work = yaml.safeLoad(fs.readFileSync("work.yml", "utf8"));
const config = Object.assign(
  yaml.safeLoad(fs.readFileSync("config.yml", "utf8")),
  work
);
const site = yaml.safeLoad(
  fs.readFileSync(`works/${config.name}/config.yml`, "utf8")
);

const dist = config.proxy
  ? config.distPattern
    ? config.distPattern.replace("{name}", config.name)
    : config.proxyServer.distPattern.replace("{name}", config.name)
  : `dist/${config.name}`;

const proxy = function () {
  return config.proxyServer.urlPattern.replace("{name}", config.name);
};

const isProd = process.env.NODE_ENV === "prod";

const dev = function (task) {
  return isProd ? noop() : task;
};

const prod = function (task) {
  return isProd ? task : noop();
};

const [script] = argv._;
console.info(`\n[GULPWORK] Script: ${script}`);

if (script == "clone") {
  if (!argv.origin) {
    argv.origin = "default";
  }
  console.info(" --------------------------------------");
  console.info("     NAME: " + argv.name);
  console.info("   ORIGIN: " + argv.origin);
  console.info(" --------------------------------------");
} else {
  console.info(" --------------------------------------");
  console.info("      ENV: " + (isProd ? "prod" : "dev"));
  console.info("     WORK: " + config.name);
  if (config.proxy) {
    console.info("    PROXY: " + proxy());
    console.info("     DIST: " + dist);
  }
  console.info(" --------------------------------------");
}

const taskDelay = 5000;

const port = argv.port || 9000;
const bs = browserSync.create(config.name);

const scssDir = `works/${config.name}/styles`;
const scssIncludePaths = [`works/${config.name}/styles/includes`];

const isVendor = function (filename) {
  var ext = path.extname(filename);
  return path.basename(filename, ext) === "vendor";
};

const sassOf = function (task, filename) {
  return isVendor(filename) ? noop() : task;
};

const babelOf = function (task, filename) {
  return isVendor(filename) ? noop() : task;
};

const getVendorsGlob = function (dir) {
  let glob = [];
  for (let vendor of site.vendors) {
    if (config.vendors[vendor][dir]) {
      for (let item of config.vendors[vendor][dir]) {
        glob.push(`node_modules/${item}`);
      }
    }
  }
  return glob;
};

const getGlob = function (dir, ext) {
  let glob = [];
  for (let item of site[dir]) {
    glob.push(`${dir}/${item}`);
  }
  glob.push(`works/${config.name}/${dir}/**/*.${ext}`);
  return glob;
};

const _favicon = function (glob) {
  return src(glob).pipe(dest(`${dist}/`));
};

const _html = function (glob) {
  return src(glob)
    .pipe(
      htmlmin(
        config.beautify
          ? undefined
          : {
              collapseWhitespace: true,
            }
      )
    )
    .pipe(dest(`${dist}/`));
};

const _fonts = function (glob) {
  return src(glob, {
    since: lastRun(fonts),
  }).pipe(dest(`${dist}/fonts/`));
};

const _images = function (glob) {
  return src(glob, {
    base: `works/${config.name}/images`,
    since: lastRun(images),
  })
    .pipe(imagemin())
    .pipe(dest(`${dist}/images/`));
};

const _styles = function (glob, filename) {
  return src(glob, {
    since: lastRun(styles),
  })
    .pipe(cached(filename))
    .pipe(sassOf(sassPartialsImported(scssDir, scssIncludePaths), filename))
    .pipe(dev(sourcemaps.init()))
    .pipe(
      sassOf(
        sass({
          includePaths: scssIncludePaths,
        }).on("error", sass.logError),
        filename
      )
    )
    .pipe(
      minify(
        isVendor(filename)
          ? undefined
          : config.beautify
          ? {
              format: "beautify",
            }
          : undefined
      )
    )
    .pipe(prefix())
    .pipe(remember(filename))
    .pipe(concat(filename))
    .pipe(
      dev(
        sourcemaps.write(".", {
          sourceRoot: "css-source",
        })
      )
    )
    .pipe(dest(`${dist}/css/`));
};

const _scripts = function (glob, filename) {
  return src(glob, {
    since: lastRun(scripts),
  })
    .pipe(dev(sourcemaps.init()))
    .pipe(cached(filename))
    .pipe(
      babelOf(
        babel({
          presets: ["@babel/env"],
        }),
        filename
      )
    )
    .pipe(
      uglify(
        isVendor(filename)
          ? undefined
          : config.beautify
          ? {
              output: {
                beautify: true,
              },
            }
          : undefined
      )
    )
    .pipe(remember(filename))
    .pipe(concat(filename))
    .pipe(
      dev(
        sourcemaps.write(".", {
          sourceRoot: "js-source",
        })
      )
    )
    .pipe(dest(`${dist}/js/`));
};

const vendors = [
  function vendorsFonts(cb) {
    let glob = getVendorsGlob("fonts");
    if (glob.length > 0) {
      return _fonts(glob);
    } else {
      cb();
    }
  },
  function vendorsStyles(cb) {
    let glob = getVendorsGlob("styles");
    if (glob.length > 0) {
      return _styles(glob, "vendor.css", null);
    } else {
      cb();
    }
  },
  function vendorsScripts(cb) {
    let glob = getVendorsGlob("scripts");
    if (glob.length > 0) {
      return _scripts(glob, "vendor.js");
    } else {
      cb();
    }
  },
];

const globs = {
  fonts: [`works/${config.name}/fonts/**/*.*`],
  images: [`works/${config.name}/images/**/*.*`],
  favicon: [`works/${config.name}/favicon.ico`],
  html: [`works/${config.name}/*.html`],
  styles: getGlob("styles", "scss"),
  scripts: getGlob("scripts", "js"),
};

function clean() {
  return del([dist], {
    force: true,
  });
}

function favicon() {
  return _favicon(globs.favicon);
}

function html() {
  return _html(globs.html);
}

function fonts() {
  return _fonts(globs.fonts);
}

function images() {
  return _images(globs.images);
}

function styles() {
  return _styles(globs.styles, "main.css");
}

function scripts() {
  return _scripts(globs.scripts, "main.js");
}

function test() {
  return src(globs.scripts)
    .pipe(
      jshint({
        esversion: 6,
      })
    )
    .pipe(jshint.reporter("default"))
    .pipe(jshint.reporter("fail"));
}

function server(cb) {
  let paramas = {
    notify: false,
    port,
  };
  if (config.proxy) {
    Object.assign(paramas, {
      proxy: proxy(),
    });
  } else {
    Object.assign(paramas, {
      server: {
        baseDir: [dist],
      },
    });
  }
  bs.init(
    paramas,
    (function () {
      if (isProd) {
        return function () {};
      }
      return function () {
        watch(
          globs.fonts,
          {
            delay: taskDelay,
          },
          fonts
        ).on("unlink", function (filepath) {
          del(slash(path.join(dist, "fonts", path.basename(filepath))), {
            force: true,
          });
        });

        watch(
          globs.images,
          {
            delay: taskDelay,
          },
          images
        ).on("unlink", function (filepath) {
          del(slash(path.join(dist, "images", path.basename(filepath))), {
            force: true,
          });
        });

        watch(globs.html, html).on("unlink", function (filepath) {
          del(slash(path.join(dist, path.basename(filepath))), {
            force: true,
          });
        });

        watch(globs.styles, styles).on("unlink", function (filepath) {
          delete cached.caches["main.css"][path.join(__dirname, filepath)];
          remember.forget(
            "main.css",
            path.join(__dirname, filepath.replace(/\.scss$/i, ".css"))
          );
        });

        watch(globs.scripts, scripts).on("unlink", function (filepath) {
          delete cached.caches["main.js"][path.join(__dirname, filepath)];
          remember.forget("main.js", path.join(__dirname, filepath));
        });

        watch(`${dist}/**/*`).on("change", bs.reload).on("unlink", bs.reload);
      };
    })()
  );
  cb();
}

function initWork(cb) {
  if (!fs.existsSync(`works/${argv.origin}`)) {
    throw new Error("Origin not exists");
  }
  if (!argv.name) {
    throw new Error(
      "Value for name paramer is not specified, please use: yarn clone --name=value"
    );
  }
  if (fs.existsSync(`works/${argv.name}`)) {
    throw new Error("Dest already exists");
  }
  return src(`works/${argv.origin}/**/*`, {
    base: `./works/${argv.origin}`,
  }).pipe(dest(`works/${argv.name}`));
}

function writeReadme(cb) {
  fs.writeFile(
    `works/${argv.name}/README.md`,
    `# ${argv.name.slice(0, 1).toUpperCase() + argv.name.slice(1)}\n\n`,
    {
      flag: "w",
    },
    function (err) {
      if (err) {
        throw err;
      }
    }
  );
  cb();
}

const clone = series(initWork, writeReadme);
const start = series(
  clean,
  parallel(...vendors),
  parallel(fonts, images, styles, series(test, scripts), favicon, html),
  server
);

exports.clone = clone;
exports.start = start;
exports.default = start;

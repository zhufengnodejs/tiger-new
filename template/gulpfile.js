var gulp = require('gulp');
var rsync = require('gulp-rsync');
var through = require("through2");
var gutil = require('gulp-util');
var path = require('path');
var fs = require('fs-extra');
var lodash = require('lodash');
var plumber = require('gulp-plumber');
var notify = require("gulp-notify");
var ora = require('ora');
var execSync = require('child_process').execSync;

var paths = require('./scripts/config/paths');
var pkg = require(paths.appPackageJson);

var staticFileName = 'static.config.json';
var staticConfigFile = path.resolve(paths.root, staticFileName);
var oldStaticConfig = lodash.invert(getStaticConfig(staticConfigFile));
var newStaticConfig = {};

function hasInstallServe(){
    try {
        execSync('serve --version', {
            stdio: 'ignore'
        });
        return true;
    } catch (e) {
        return false;
    }
}

function getStaticConfig(path) {
    try {
        return require(path) || {};
    } catch (e) {
        return {};
    }
}

function handleError(err) {
    gutil.beep();
    gutil.log(err.toString());
    notify.onError("Error: <%= error.message %>")(err);
    this.emit('end');
}

/*!
 * @desc 合并多个文件流只执行最后一个
 * @author qiqiboy
 */
function one(callback) {
    var last;
    return through.obj(function(file, enc, cb) {
        last = file;
        cb();
    }, function(cb) {
        this.push(last);
        callback && callback();
        cb();
    });
}

function removeFileNameHash(fileName) {
    var pipes = fileName.split('.');
    pipes.splice(-2, 1);
    return pipes.join('.');
}

gulp.task('cdn', function() {
    var failNum = 0;
    var exitsNum = 0;
    var uploadNum = 0;
    var files = [];
    var spinner = ora('开始上传').start();

    return gulp.src(paths.appBuild + '/static/**/*')
        .pipe(plumber({
            errorHandler: handleError
        }))
        .pipe(through.obj(function(file, enc, cb) {
            if (file._contents) {
                if (oldStaticConfig[path.join(file.relative)]) {
                    exitsNum++;
                    spinner.succeed(gutil.colors.green('已存在：' + file.relative));
                } else {
                    files.push(file);
                }

                newStaticConfig[removeFileNameHash(file.relative)] = file.relative;
            }

            cb();
        }, function(cb) {
            var self = this;
            var delay = 0;

            if (files.length) {
                files.forEach(function(file) {
                    var error;
                    setTimeout(function() {
                        gulp.src(file.path)
                            .pipe(plumber({
                                errorHandler: function(err) {
                                    failNum++;
                                    error = true;
                                    gutil.beep();
                                    spinner.fail(gutil.colors.red('上传失败(' + err.message + ')：' + file.relative));
                                    this.emit('end');
                                }
                            }))
                            .pipe(rsync({
                                root: paths.appBuild,
                                silent: true,
                                hostname: 'static',
                                compress: true,
                                destination: '/data0/webservice/static' + pkg.cdn.path
                            }))
                            .pipe(one(function() {
                                if (!error) {
                                    uploadNum++;
                                    spinner.warn(gutil.colors.yellow('已上传：' + file.relative));
                                }

                                if (uploadNum + failNum == files.length) {
                                    showResult(cb);
                                }
                            }));
                    }, delay += 100);
                    self.push(file);
                });
            } else {
                showResult(cb);
            }
        }));

    function showResult(cb) {
        console.log(gutil.colors[failNum ? 'red' : 'cyan']('+++++++++++++++++++++++++++++++\n 文件上传完毕(' + gutil.colors.blue(pkg.cdn.path) + ') \n ' + gutil.colors.magenta('成功：' + uploadNum) + ' \n ' + gutil.colors.red('失败:' + failNum) + ' \n ' + gutil.colors.green('重复：' + exitsNum) + '\n+++++++++++++++++++++++++++++++'));
        if (!failNum) {
            fs.outputFile(staticConfigFile, JSON.stringify(newStaticConfig, '\n', 4));
            console.log(gutil.colors.blue("配置文件已经更新: " + staticConfigFile));
            console.log();
            console.log(gutil.colors.green('项目已经成功编译，运行以下命令可即时预览：'));
            if(!hasInstallServe()) {
                console.log(gutil.colors.cyan('npm') + ' install -g serve');
            }
            console.log(gutil.colors.cyan('serve') + ' -s ' + path.relative('.', paths.appBuild));
            console.log();
            cb();
        } else {
            console.log(gutil.colors.red("文件未全部上传，请单独运行") + gutil.colors.green(' gulp cdn ') + gutil.colors.red("命令!"));
            cb();
        }
    }
});

define('function-widget-1:widget/system/utils/ab.js', function(require, exports, module){ /**
 * @file 峙一AB实验
 */

var scriptLoader = require('base:widget/pc-invoker/loadScript.js');

var scriptSrc = 'https://nd-static.bdstatic.com/m-static/base/thirdParty/ab/bp-abtest-jssdk.1.0.21.min.js';
var loader = scriptLoader.getLoader();

var pri = {
    getBpABTest: function(cb, errorCb) {
        return loader.load(scriptSrc, cb, errorCb);
    },
    getBpABTestInstance: function(productName) {
        return new Promise(function(resolve, reject) {
            pri.getBpABTest(function() {
                resolve(window.BpABTest.getInstance(productName || 'netdisk'));
            }, function() {
                reject(new Error('load bp-abtest-jssdk failed'));
            });
        });
    },
    getSidListArr() {
        return this.getBpABTestInstance().then(bpABTest => {
            return bpABTest.getSidListArr();
        });
    },
    getInfoByKeys: function(keys) {
        return this.getBpABTestInstance().then(bpABTest => {
            return bpABTest.getInfoByKeys(keys);
        });
    },
    getInfoByKey(key) {
        return this.getBpABTestInstance().then(bpABTest => {
            return bpABTest.getInfoByKey(key);
        });
    }
};

module.exports = pri;
 
});
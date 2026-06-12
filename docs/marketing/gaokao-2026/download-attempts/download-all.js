define("function-widget-1:download/config.js",function(_,E,I){var L={fileSizeSmall:0,fileSizeLimit:50,isDefaultSize:!0,isRequestServer:!1},F="0",D="1",N="0",i="1",O="2",e="0",S="1",o="2",R="0",M="1",n="0",T="1",A="0",P="1",l="2",a="0",f="1",C=[["01","012","0","1","01","012","01"],["01","012","0","0","0","0","0"]],U=[["01","012","0","0","1","012","01"],["01","012","0","0","01","2","01"],["01","012","0","0","01","012","1"],["01","012","2","01","01","012","01"],["01","012","1","01","1","012","01"],["01","012","1","01","01","2","01"]],d=[["01","012","0","0","0","1","0"],["01","012","1","01","0","01","01"]];I.exports={sizeConfig:L,PLATFORM_MAC:D,PLATFORM_WINDOWS:F,PRODUCT_PAN:N,PRODUCT_SHARE:i,PRODUCT_UNIONDIR:O,FILE_NUM_SINGLE:e,FILE_NUM_MULTIPLE:S,FILE_NUM_MORE_100:o,FILE_NODLINK:R,FILE_HASDLINK:M,FILE_NOTDIR:n,FILE_HASDIR:T,FILE_SIZE_LESS_SMALL:A,File_SIZE_BETWEEN_SMALL_AND_LIMIT:P,FILE_SIZE_MORE_LIMIT:l,FILE_TYPE_GENERAL:a,FILE_TYPE_CHROMEAPKEXE:f,directDownloadkeysConfig:C,guanjiaDownloadkeysConig:U,dialogDownloadkeysConfig:d,INDEX_OF_PLATFORM:0,INDEX_OF_PRODUCT:1,INDEX_OF_FILENUM:2,INDEX_OF_DLINK:3,INDEX_OF_ISDIR:4,INDEX_OF_FILESIZE:5,INDEX_OF_FILETYPE:6}});
;define("function-widget-1:download/log.js",function(o,e,t){t.exports={event:{},ajax:{"/api/download":{logType:"dis",description:"下载文件",callback:function(o,e){return[{name:"downloadHttpTime",value:e&&e.time},{name:"downloadHttpStatus",value:e&&e.responseData&&e.responseData.errno}]}}},mix:{chromeStraightforwardDownload:{logType:"count",description:"chrome直接下载文件"},httpsAccessFail:{logType:"count",description:"https访问失败"},httpsAccessSuccess:{logType:"count",description:"https访问成功"},https_pub:{logType:"count",description:"是否命中https访问的小流量"},callGuanjia:{logType:"count",description:"是否成功调起云管家"},tab_download_click:{logType:"count",description:"选中文件后点上方按钮文件下载"},list_download_click:{logType:"count",description:"列表下载按钮文件下载"},file_down_count:{logType:"count",description:"文件下载统计(不包含文件夹)"},call_guanjia_local_success:{logType:"count",description:"下载本地服务调起成功"},call_guanjia_local_fail:{logType:"count",description:"下载本地服务调起失败"},call_guanjia_local:{logType:"count",description:"下载本地服务调起"},call_guanjia_server:{logType:"count",description:"下载长连接方式调起"},getBrowserIdByServer:{logType:"count",description:"发送长连接调起browserId请求"},checkIsOnlineByServer:{logType:"count",description:"发送长连接调起online请求"},callGuanjiaByServer:{logType:"count",description:"发送长连接调起send请求"},checkGuanjiaStatusByServer:{logType:"count",description:"发送长连接调起check请求"}}}});
;define("function-widget-1:download/util/context.js",function(t,n,e){var o=t("function-widget-1:download/log.js"),i=/\.(\w+)$/,u=null;e.exports={getContext:function(){return u},setContext:function(t){u||(u=t,t&&t.log&&t.log.define(o))},getExtName:function(t){if("string"!=typeof t)return"";var n=i.exec(t);return n[1]?n[1]:""}}});
;define("function-widget-1:download/service/dlinkService.js",function(t,e,r){var o=t("base:widget/libs/jquerypacket.js"),a=t("base:widget/libs/underscore.js"),n=t("function-widget-1:download/util/context.js").getContext,i=t("base:widget/vip/vip.js"),s=t("base:widget/tools/service/tools.cookie.js").getCookie,c=t("base:widget/tools/service/tools.url.js"),d={PRODUCT_PAN:"pan",PRODUCT_MBOX:"mbox",PRODUCT_SHARE:"share",currentProduct:null,dialog:null,sign:null,setCurrentProduct:function(t){this.currentProduct=t},getCurrentProduct:function(){return this.currentProduct},URL_DLINK_PAN:"/api/download",URL_DLINK_SHARE:"/api/sharedownload",DOC_URL_DLINK_SHARE:"/api/docsharedownload",_doError:function(t,e,r){var o="",a=this;n().log.send({type:"serviceError"+n().locals.get("uk")||"serviceError",from:"errorCode"+t});var i=n().accountBan(t);return i.isBan?!1:(2===t&&(o="下载失败，请稍候重试"),116===t&&(o="该分享不存在！"),-1===t&&(o="您下载的内容中包含违规信息！"),118===t&&(o="没有下载权限！"),(113===t||112===t)&&(o='页面已过期，请<a href="javascript:window.location.reload();">刷新</a>后重试'),-20===t?void a._showVerifyDialog():(121===t&&(o="你选择操作的文件过多，减点试试吧。"),(31326===t||31426===t)&&(o=e?decodeURIComponent(e):"下载失败"),o=r||o,o=o||"网络错误，请稍候重试",void n().ui.tip({mode:"caution",msg:o,hasClose:!0,autoClose:!1})))},getFsidListData:function(t){return a.isArray(t)===!1&&(t=[t]),o.stringify(a.pluck(t,"fs_id"))},getPathListData:function(t){return a.isArray(t)===!1&&(t=[t]),o.stringify(a.pluck(t,"path"))},base64Encode:function(t){var e,r,o,a,n,i,s="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";for(o=t.length,r=0,e="";o>r;){if(a=255&t.charCodeAt(r++),r===o){e+=s.charAt(a>>2),e+=s.charAt((3&a)<<4),e+="==";break}if(n=t.charCodeAt(r++),r===o){e+=s.charAt(a>>2),e+=s.charAt((3&a)<<4|(240&n)>>4),e+=s.charAt((15&n)<<2),e+="=";break}i=t.charCodeAt(r++),e+=s.charAt(a>>2),e+=s.charAt((3&a)<<4|(240&n)>>4),e+=s.charAt((15&n)<<2|(192&i)>>6),e+=s.charAt(63&i)}return e},getDlinkPan:function(t,e,r,s,c,d,u){var p=this;n().locals.get("sign1","sign2","sign3","timestamp",function(l,g,f,h){var y;if(null===p.sign){var m="";try{m=new Function("return "+g)()}catch(_){throw new Error(_.message)}if("function"!=typeof m)return void p._doError();p.sign=p.base64Encode(m(f,l))}"[object Array]"===Object.prototype.toString.call(t)?t=o.stringify(t):"string"!=typeof t||/^\[\S+\]$/.test(t)||(t="["+t+"]"),y={sign:p.sign,timestamp:h,fidlist:t,type:e,vip:i.getVipValue()},"object"==typeof u&&a.extend(y,u),s&&c&&(y.ct=s,y.cv=c),"cardHolder"===n().router.currentRouteName&&(y.src="cardholder"),o.ajax({url:p.URL_DLINK_PAN,data:y,dataType:"json",type:d||"GET",success:function(t,e,a){n().log.send({type:"webdownload",url:"//update.pan.baidu.com/statistics",clienttype:"0",op:"download",from:y.type,product:"pan",success:t&&0===+t.errno?1:0,reason:t?t.errno:0,ajaxstatus:a.status,ajaxurl:"/api/download",ajaxdata:o.stringify(e)}),0===t.errno?t.dlink&&t.dlink.length>0?"function"==typeof r&&(t.logType="webdownload",t.logFrom=y.type,r(t)):p._doError():p._doError(t.errno,t.errmsg,t.show_msg)},error:function(t,e){n().log.send({type:"webdownload",url:"//update.pan.baidu.com/statistics",clienttype:"0",op:"download",from:y.type,product:"pan",success:0,ajaxstatus:t.status,ajaxurl:"/api/download",ajaxdata:o.stringify(e)}),p._doError()}})})},ajaxGetDlinkShare:function(t,e){var r={encrypt:0},a=this,c="doc-share"===n().pageInfo.currentSubProduct,d=c?this.DOC_URL_DLINK_SHARE:this.URL_DLINK_SHARE;n().locals.get("public","share_uk","shareid","sign","timestamp",function(u,p,l,g,f){if(0===u||c&&!u){var h=window.location.pathname.split("/s/"),y=localStorage.getItem(h[1]+"_bdclnd")||s("BDCLND");r.extra=o.stringify({sekey:decodeURIComponent(y)})}var m=o.extend({},r,t),_=m.sign,v=m.timestamp;delete m.sign,delete m.timestamp,m.vip=i.getVipValue(),o.ajax({type:"POST",url:d+"?sign="+_+"&timestamp="+v,data:m,dataType:"json",success:function(t,r,i){return n().log.send({type:"websharedownload",url:"//update.pan.baidu.com/statistics",clienttype:"0",op:"download",from:m.product,product:"pan",success:t&&0===+t.errno?1:0,reason:t?t.errno:0,ajaxstatus:i.status,ajaxurl:d,ajaxdata:o.stringify(r)}),t?void(0===t.errno?(m.product===a.PRODUCT_SHARE,"function"==typeof e&&(t.logType="websharedownload",t.logFrom=m.product,e(t))):a._doError(t.errno,t.errmsg,t.show_msg)):void a._doError()},error:function(t,e){n().log.send({type:"websharedownload",url:"//update.pan.baidu.com/statistics",clienttype:"0",op:"download",from:m.product,product:"pan",success:0,ajaxstatus:t.status,ajaxurl:d,ajaxdata:o.stringify(e)}),a._doError()}})})},getDlinkShare:function(){var t=function(t){var e={product:d.PRODUCT_SHARE,encrypt:0,timestamp:"",sign:""},r={};t.vcode_input&&t.vcode_str&&(r.vcode_input=t.vcode_input,r.vcode_str=t.vcode_str),t.type&&(r.type=t.type),t.isForBatch===!0&&(r.type="batch"),t.isForGuanjia===!0&&(r.encrypt=1),t.ct&&t.cv&&(r.ct=t.ct,r.cv=t.cv);var a={};return"doc-share"===n().pageInfo.currentSubProduct&&(a={surl:window.location.pathname.split("/s/9/")[1],attachfsid:c.getParam("fid")}),r=o.extend({},e,r,{uk:t.share_uk,primaryid:t.share_id,product:t.product,fid_list:t.list?d.getFsidListData(t.list):"",path_list:t.path?d.getPathListData(t.path):"",sign:t.sign,timestamp:t.timestamp},a)};return function(e,r){this.arguments=arguments,this.ajaxGetDlinkShare(t(e),r)}}(),_showVerifyDialog:function(t){var e=this;e.dialog=n().ui.verify({title:"提示",prod:"pan",onSure:function(r,o){return"function"==typeof t?t(r,o):(e.arguments[0].vcode_str=r,e.arguments[0].vcode_input=o,void e.arguments.callee.apply(e,e.arguments))},onClose:function(){n().ui.hideTip()}}),e.dialog.show()}};r.exports=d});
;define("function-widget-1:download/util/downloadCommonUtil.js",function(e,t,n){var o=e("base:widget/libs/jquerypacket.js"),r=e("base:widget/libs/underscore.js"),i=e("function-widget-1:download/service/dlinkService.js"),s=e("base:widget/tools/service/tools.flash.js"),a=e("function-widget-1:download/util/context.js").getContext,c={getFlashVersion:function(){var e=0,t=navigator;if(t.plugins&&t.plugins.length){for(var n=0,o=t.plugins.length;o>n;n++)if(-1!==t.plugins[n].name.indexOf("Shockwave Flash")){e=t.plugins[n].description.split("Shockwave Flash ")[1];break}}else if(window.ActiveXObject)try{var r=new ActiveXObject("ShockwaveFlash.ShockwaveFlash");if(r){var i=r.GetVariable("$version"),s=/WIN ([\d\.\,]+)/g,a=s.exec(i);a&&(e=a[1])}}catch(c){}return e},compareVersion:function(e,t,n){return"string"==typeof e&&(e=e.replace(/(^|\.)(\d)(?=\.|$)/g,"$10$2").replace(/\./g,""),e=e.length<=6?e+="00":e,e=parseInt(e,10)),"string"==typeof t&&(t=t.replace(/(^|\.)(\d)(?=\.|$)/g,"$10$2").replace(/\./g,""),t=t.length<=6?t+="00":t,t=parseInt(t,10)),n?e>t:e>=t},getDownloadLogmsg:function(){var e;return e=i.getCurrentProduct()===i.PRODUCT_SHARE?2:1},useToast:function(e){a().ui.tip({mode:e.toastMode,msg:e.msg})},useCloseToast:function(){a().ui.hideTip()},getPackName:function(e){var t,n=a().tools.baseService.parseDirFromPath(e[0].path),o=e[0].isdir;if("number"==typeof e.length){var r=e.length>1?"【批量下载】{%packName%}等.zip":"{%packName%}.zip";return 0===o&&(t=n.lastIndexOf("."),-1!==t&&(n=n.substring(0,t))),r.replace(/{%packName%}/g,n)}return a().tools.baseService.parseDirFromPath(e[0].path)},isFile:function(e){return 0===e||void 0===e?!0:!1},isPlatformWindows:function(){var e=navigator.platform;return 0===e.toLowerCase().indexOf("win")},isPlatformMac:function(){var e=/Mac\D+(\d+).(\d*)/gi,t=e.exec(navigator.userAgent);return t&&t[1]&&(+t[1]>10||10===+t[1]&&t[2]&&+t[2]>=10)?!0:!1},getDownloadUrl:function(e){return o.browser.msie?e.dlink+"&response-cache-control=private":e.dlink},isChromeAndGreaterThan42:function(){var e="42";return c.getChromeVersion()>=e?!0:!1},getChromeVersion:function(){var e,t=navigator.userAgent.toLowerCase(),n=/chrome/,o=/safari\/\d{3}\.\d{2}$/,r=/chrome\/(\S+)/;return n.test(t)&&o.test(t)&&r.test(t)?e=RegExp.$1:0},isChrome:function(){var e=navigator.userAgent.toLowerCase(),t=/chrome/;return t.test(e)?!0:!1},ctrBrowserVersion:function(e,t,n){var o="get"+e.slice(0,1).toUpperCase()+e.slice(1)+"Version",r=c[o],i=parseInt(r(),10),n=parseInt(n,10);return"<"===t?n>i:"=="===t||"==="===t?i===n:"<="===t?n>=i:">="===t?i>=n:">"===t?i>n:void 0},shouldKeepAlive:function(){return location.protocol.indexOf("https")>-1&&(!s.checkFlashSupport()||c.isPlatformMac()&&c.ctrBrowserVersion("firefox",">","50")||c.ctrBrowserVersion("chrome","==","59"))},isFirefoxAndGreaterThan50:function(){var e="50";return c.isFirefox()&&c.getFirefoxVersion()>e?!0:!1},getFirefoxVersion:function(){var e,t=navigator.userAgent.toLowerCase(),n=/firefox\/(\S+)/;return n.test(t)?e=RegExp.$1:0},isFirefox:function(){var e=navigator.userAgent.toLowerCase(),t=/firefox/;return t.test(e)?!0:!1},toLogin:function(){var t=this;this.useToast({toastMode:"loading",msg:"请稍候..."}),e.async("base:widget/passAPI/passAPI.js",function(e){t.useCloseToast(),e.promise.done(function(){e.passAPI.PassportInit.netdiskLogin({reload:!0}),e.passAPI.PassLoginDialog.onLoginSuccessCallback=function(){e.passAPI.PassportInit.hide(),a().log.send({type:"download_share_single_size_limit_login_success"})}}),a().log.send({type:"download_share_single_size_limit_login_dialog_show"})})},openYunGuanjiaByScheme:function(e,t){var n=!1,r=function(){n=!0};o(window).on("blur",r);var i=function(){n&&setTimeout(function(){"function"==typeof t&&t()},100),n=!1,o(window).off("focus",i)};if(o(window).on("focus",i),c.isChrome()){var s=document.createElement("a"),a=null;"function"==typeof MouseEvent?a=new MouseEvent("click",{bubbles:!0,cancelable:!1}):(a=document.createEvent("MouseEvents"),a.initEvent("click",!0,!1)),s.href=e,s.dispatchEvent(a)}else{var u=c.callClientIframe;u||(u=document.createElement("iframe"),o(u).hide(),c.callClientIframe=u,document.body.appendChild(u)),u.src=e}setTimeout(function(){o(window).off("blur",r),n||(o(window).off("focus",i),"function"==typeof t&&t())},100)},checkIsShare:function(){var e=a().router,t=e.currentRouteName;return"sharedir"===t?!0:"video"===t?/^\/<share>\d+-\d+\//.test(e.query.get("path")):!1},getFileSizeType:function(e){for(var t=1048576,n=0,o=1===e.length,r=0,i=[],s=0;s<e.length&&!(n>300*t);s++)n+=e[s].size;return n=Math.ceil(n/t),o?(i=[0,50,100,200,300],i.sort(function(e,t){return n>e&&t>=n?r=e:n>t&&(r=t),r})):(i=[0,100,300],i.sort(function(e,t){return n>e&&t>=n?r=e:n>t&&(r=t),r})),r},hasShare:function(e){return r.some(e,function(e){return e.share})},judgeVideo:function(e,t){return r.some(e,function(e){return t===!0?1===+e.category:1!==+e.category})}};n.exports=c});
;define("function-widget-1:download/util/pcsUtil.js",function(t,e,n){function o(t,e){for(var n,o=0,i=e.length;i>o;o++){n=e[o];var s=new Image;s.pid=n.id,s.onload=function(){a+=this.pid},s.src="//"+n.host+(t||"/monitor.jpg?xcode=1a81b0bbd448fc368d78cc336e28561a")+(new Date).getTime()}}var i=t("base:widget/libs/jquerypacket.js"),s=0,a=0,c=window.host&&window.host.HOST_D_PCS||"d.pcs.baidu.com";i.ajax({url:"https://"+c+"/rest/2.0/pcs/manage?method=listhost&t="+(new Date).getTime(),method:"get",dataType:"jsonp",success:function(t){t&&t.list&&(s=t.rev||0,o(t.path,t.list))}}),n.exports.getPCSSuffix=function(){return a&&s?"&cflg="+encodeURIComponent(a+":"+s):""}});
;define("function-widget-1:download/service/downloadDirect.js",function(o,n,e){function t(o){var n="";n=D.isNormalSingleFile?"downloadfile|downloadSize_"+o[0].size+"|downloadFileLength_1|downloadFileCategory_."+o[0].path.split(".")[o[0].path.split(".").length-1]:"downloadfile|downloadFileLength_"+o.length,h().log.send({page:f.getDownloadLogmsg(),type:n,pf:navigator.platform,fileSize:f.getFileSizeType(D.list),md5:o[0].md5||"proxypcs"}),/chrome\/(\d+\.\d+)/i.test(navigator.userAgent)&&h().log.send({name:"chromeStraightforwardDownload",sendServerLog:!1,value:"chrome"})}function i(){var o=g.browser,n=!1;return o.msie&&parseInt(o.version,10)<=8&&(n=!0),n}function d(o){var n=o.dlink+w();return n&&0===n.indexOf("http://")&&"https:"===window.location.protocol&&(n=n.replace("http://",window.location.protocol+"//")),g.browser.msie&&(n+="&response-cache-control=private"),n}function a(){if(!L){var o=document.createElement("div");o.className="pcs-hide-ele",o.innerHTML='<iframe src="javascript:;" id="pcsdownloadiframe" name="pcsdownloadiframe" style="display:none"></iframe><form target="pcsdownloadiframe" enctype="application/x-www-form-urlencoded" action="'+S+'" method="post" name="pcsdownloadform"><input name="method" value="batchdownload" type="hidden" /><input name="zipcontent" type="hidden" /><input name="zipname" type="hidden" /></form>',document.body.appendChild(o)}L=!0}function l(o){var n=null;a(),n=document.getElementById("pcsdownloadiframe");var e=o.dlink.match(/(http|https):\/\/([^\/]*)\/.*/),t=e?e[2]:"";n.onload=n.onreadystatechange=function(){try{var e=n.contentDocument||n.contentWindow.document;if(g.browser.mozilla&&0===e.body.children.length)return}catch(i){}h().ui.tip({mode:"caution",msg:"下载失败，请重试",hasClose:!0,autoClose:!1}),h().log.send({type:o.logType||"webotherdownload",url:"//update.pan.baidu.com/statistics",clienttype:"0",op:"download",product:"pan",from:o.logFrom,success:0,reason:"dlinkDownloadFailed",dlinkDomain:t}),h().log.send({type:"iframeError"+h().locals.get("uk")||"iframeError",from:encodeURIComponent(n.src)}),h().log.send({type:"web_download_error",from:encodeURIComponent(n.src),tip:"iframeError"+h().locals.get("uk"),clienttype:"0",op:"download",product:"pan",from:o.logFrom,success:0,reason:"dlinkDownloadFailed",dlinkDomain:t})},n.src=d(o),h().log.send({type:"iframeDownLoad"+h().locals.get("uk")||"iframeDownLoad",from:encodeURIComponent(n.src)})}function r(o){if(i()){var n=h().ui.confirm({title:"提示",body:"下载链接已生成，请点击下载。",sureText:"立即下载",onSure:function(){n.hide(),l(o),h().log.send({page:f.getDownloadLogmsg(),type:"download_browser_lteq_ie8"})}});n.show()}else l(o)}function c(o,n){h().locals.get("uk","sign1","timestamp",function(e,t,i){var d="batch"===n,a={path:D.list,product:"sf",hasDlink:!0,share_uk:e,share_id:o[0].fs_id,sign:t,timestamp:i,isForBatch:d};v.getDlinkShare(a,function(o,n){var e="";d?e+=o.dlink+"&zipname="+encodeURIComponent(f.getPackName(D.list)):e=o[n||"list"][0].dlink,I.dlink=e,o.logType&&(I.logType=o.logType),o.logFrom&&(I.logFrom=o.logFrom),r(I)})})}function s(o,n){var e=o.every(function(o){return!!o.needHidden}),t={};e&&(t.src="xpan"),v.getDlinkPan(v.getFsidListData(o),n,function(e){"batch"===n?I.dlink=e.dlink+"&zipname="+encodeURIComponent(f.getPackName(o)):"dlink"===n&&(I.dlink=e.dlink[0].dlink),r(I)},void 0,void 0,void 0,t)}function p(o,n){D.isForBatch="batch"===n,1===o.length?v.getDlinkShare(D,function(o){I.dlink=D.isForBatch?o.dlink:o.list[0].dlink,r(I)}):v.getDlinkShare(D,function(n){I.dlink=n.dlink+"&zipname="+encodeURIComponent(f.getPackName(o)),r(I)})}function m(o){I=o[0];var n="directDownloadIn"+_[y[1]];y[3]===k.FILE_HASDLINK&&r(I),y[3]===k.FILE_NODLINK&&(y[4]===k.FILE_HASDIR?F[n](o,"batch"):F[n](o,"dlink"))}function u(o){I={};var n="directDownloadIn"+_[y[1]];F[n](o,"batch")}var g=o("base:widget/libs/jquerypacket.js"),f=o("function-widget-1:download/util/downloadCommonUtil.js"),w=o("function-widget-1:download/util/pcsUtil.js").getPCSSuffix,h=o("function-widget-1:download/util/context.js").getContext,k=o("function-widget-1:download/config.js"),v=o("function-widget-1:download/service/dlinkService.js"),y="",D={},I={},F={directDownloadInPan:s,directDownloadInShare:p,directDownloadInUniondir:c},_={0:"Pan",1:"Share",2:"Uniondir"},b=window.host&&window.host.HOST_PCS||"pcs.baidu.com",S="https://"+b+"/rest/2.0/pcs/file?method=batchdownload&app_id=250528",L=!1;e.exports={start:function(o,n){y=o,D=n;var e=D.list;y[2]===k.FILE_NUM_SINGLE&&m(e),y[2]===k.FILE_NUM_MULTIPLE&&u(e),t(e)}}});
;define("function-widget-1:download/util/downloadGuanjiaUtil.js",function(i,n,e){var u=i("base:widget/libs/jquerypacket.js"),a=i("function-widget-1:download/util/context.js").getContext,t=i("function-widget-1:download/util/downloadCommonUtil.js"),s=String(navigator.platform).indexOf("Linux")>-1;e.exports={getFormatedLinkList:function(i,n){for(var e={},u=null,a=0;a<n.length;a++)e[n[a].fs_id]=n[a].dlink;for(var t=0;t<i.length;t++)u=i[t].fs_id,i[t].link=e[u];return i},doError:function(i){var n=navigator.userAgent.toLowerCase(),e="启动百度网盘客户端失败，请安装最新版本";/x64/g.test(n)===!0&&/msie\s[678]/i.test(n)===!0?e="加速下载暂不支持64位浏览器，请换个浏览器试试":n.indexOf("se 2.x")>-1?e="无法启动百度网盘客户端，请换个浏览器试试":n.indexOf("360se")>-1?e="无法启动百度网盘客户端，请换个浏览器试试":void 0===i?e="插件已被禁用，请查看浏览器插件设置":-2==i?e="启动百度网盘客户端失败，请重启浏览器后重试":-4==i&&(e="检测到百度网盘客户端已卸载，请重新安装后重试"),a().ui.tip({mode:"caution",msg:e})},getGuanjiaDownloadUrl:function(i){function n(i){if(!i)return r;var n=i.match(/\B[\d.]+$/);return n&&n[0]?n[0]:r}var e={url:"",version:""},r="5.4.4",o=navigator.userAgent,l=/(?:windows NT )(\d+\.\d)/i,d=o.match(l),c=null;d&&d[1]&&(c=parseInt(d[1].replace(".",""),10)),u.ajax({url:"/disk/cmsdata?do=client",type:"GET",dataType:"JSON",cache:!1,success:function(u){if(0===u.errorno)try{if(t.isPlatformMac())e.url=u.mac?u.mac.url:"",e.version=n(u.mac.version);else if(s)e.url=u.linux&&u.linux.url&&u.linux.url_1?[u.linux.url,u.linux.url_1]:"",e.version=n(u.linux.version);else{if(c)if(61>c)e.url=u.guanjia?u.guanjia.url_1:"";else{var o=u.guanjia?u.guanjia.url:"";"share"===a().pageInfo.currentProduct&&a().locals.get("isPcShareIdWhiteList","pcClientDownloadLink",function(i,n){1===i&&n&&(o=n)}),e.url=o}else e.url=u.guanjia?u.guanjia.url_1:"";e.version=n(u.guanjia.version)}}catch(l){e.version=r}else e.version=r;e.url=e.url||"http://issuecdn.baidupcs.com/issue/netdisk/yunguanjia/BaiduYunGuanjia_5.4.4.exe","function"==typeof i&&i(e)},error:function(){t.isPlatformMac()?(e.url="http://issuecdn.baidupcs.com/issue/netdisk/MACguanjia/BaiduNetdisk_mac_3.0.5.4.dmg",e.version="3.0.5"):s?(e.url=["http://issuecdn.baidupcs.com/issue/netdisk/LinuxGuanjia/3.0.1/baidunetdisk_linux_3.0.1.2.rpm","http://issuecdn.baidupcs.com/issue/netdisk/LinuxGuanjia/3.0.1/baidunetdisk_linux_3.0.1.2.deb"],e.version="3.0.1"):(e.url="http://issuecdn.baidupcs.com/issue/netdisk/yunguanjia/BaiduYunGuanjia_5.4.4.exe",e.version=r),"function"==typeof i&&i(e)}})}}});
;define("function-widget-1:download/service/guanjiaConnector.js",function(o,e,n){var t=o("base:widget/libs/jquerypacket.js"),i=o("base:widget/tools/tools.js"),c=o("base:widget/httpProxy/httpProxy.js").ajax,a=o("function-widget-1:download/util/downloadCommonUtil.js"),r=o("function-widget-1:download/util/context.js").getContext,l={conf:{localUrl:"http://127.0.0.1",localPort:1e4,currentPort:1e4,portPollLimit:10,guanjiaVersion:0,localServerReady:!1,domIframeId:"guanjia-iframe-id",domHookId:"guanjia-hook-id",hook:null,minVersion:"5.3.4.5"},setVersion:function(o){l.conf.guanjiaVersion=o,"http:"!==location.protocol||a.isPlatformWindows()&&!a.compareVersion(o,"5.4.7")||l.imageAccess("https://"+location.host+"/yun-static/common/images/default.gif",function(){i.setCookie("secu",1,365,"/")})},imageAccess:function(o,e,n){var t=new Image;t.onload=function(o){"function"==typeof e&&e.call(null,o)},t.onerror=function(o){"function"==typeof n&&n.call(null,o)},t.src=o},util:{init:function(o){l.conf.checkStartTime=o?+new Date:0,l.util.checkLocalServer(),a.getChromeVersion()<=42&&setTimeout(function(){l.util.localServerReady||l.util.installHook()},1e3)},checkLtIe8:function(){var o=t.browser||{};return o.msie&&+o.version<=8?!0:!1},checkLocalServer:function(){if(!l.conf.localServerReady)for(var o=0,e=function(e){var n=l.conf.localUrl+":"+e+"/guanjia",i={url:n,type:"GET",data:{method:"GetVersion"},dataType:"json",timeout:3e3,success:function(o){try{o=t.parseJSON(o)}catch(n){}if(o&&o.version){if(a.isPlatformWindows()&&!a.compareVersion(o.version,l.conf.minVersion))return;l.conf.currentPort=e,l.setVersion(o.version),l.conf.localServerReady=!0}},error:function(){o++,o===l.conf.portPollLimit&&+new Date-l.conf.checkStartTime<3e3&&setTimeout(function(){l.util.checkLocalServer()},400)}};location.protocol.indexOf("https")>-1||l.util.checkLtIe8()?a.isPlatformMac()?l.imageAccess(l.conf.localUrl+":"+e+"/version.png",function(){c(i)},i.error):c(i):t.ajax(i)},n=0;n<l.conf.portPollLimit;n++)e(l.conf.localPort+n)},installHook:function(){var o,e,n=[];return null!==l.conf.hook?l.conf.hook:(o=document.getElementById(l.conf.domIframeId),o&&document.body.removeChild(o),o=document.createElement("div"),o.style.width="1px",o.style.height="1px",o.style.position="absolute",o.style.overflow="hidden",o.style.left="-999em",o.style.top="-999em",o.id=l.conf.domIframeId,document.body.appendChild(o),n.push("undefined"!=typeof window.attachEvent||window.ActiveXObject||"ActiveXObject"in window?'<object id="'+l.conf.domHookId+'" classid="CLSID:8DCE7B6C-C3B9-4efd-9CC6-2D9F938B4A06" hidden="true" viewastext></OBJECT>':-1!==navigator.userAgent.indexOf("Trident/7.0")?'<embed id="'+l.conf.domHookId+'" type="application/bd-npYunWebDetect-plugin" width="0" height="0">':'<embed id="'+l.conf.domHookId+'" type="application/bd-npYunWebDetect-plugin" width="0" height="0">'),o.innerHTML=n.join(""),e=l.util.hasPlugin(),e&&(l.conf.hook=document.getElementById(l.conf.domHookId),l.setVersion(l.conf.hook.GetVersion())),l.conf.hook)},hasPlugin:function(){var o=null;try{o=new ActiveXObject("YunWebDetect.YunWebDetect.1")}catch(e){for(var n=null,t=navigator.plugins,i=0,c=t.length;c>i;i++)if(n=t[i].name||t[i].filename,-1!==n.indexOf("BaiduYunGuanjia")){o=t[i];break}}return null!=o},checkPluginHook:function(){return l.conf.installHook()},sendData:function(o,e,n,i,u){if(l.conf.localServerReady){var s=l.conf.localUrl+":"+l.conf.currentPort+"/guanjia?";s+="method="+o+"&uk="+n+"&checkuser="+(i?1:0);var f={url:s,type:"POST",data:{filelist:e},success:function(){r().log.send({type:"call_guanjia_local_success"})},timeout:3e3,error:function(){r().log.send({type:"call_guanjia_local_fail"}),u||a.openYunGuanjiaByScheme("baiduyunguanjia://guanjia",function(){l.conf.localServerReady=!1,l.util.init(!0),setTimeout(function(){l.util.sendData(o,e,n,i,!0)},3e3)})}};location.protocol.indexOf("https")>-1||l.util.checkLtIe8()?c(f):t.ajax(f)}else{if(!l.conf.hook)return-2;try{"undefined"==typeof i?l.conf.hook[o](e,n):l.conf.hook[o](e,n,i)}catch(d){return-2}}}}};l.setVersion(0),n.exports={getVersion:function(){return l.conf.guanjiaVersion},checkConnect:function(){return l.conf.localServerReady?!0:a.isChromeAndGreaterThan42()?!1:l.conf.hook&&l.conf.guanjiaVersion},callGuanjia:function(o,e,n,t){return l.util.sendData(o,e,n,t)},init:function(o){l.util.init(o)}}});
;define("function-widget-1:download/service/guanjiaServerProxy.js",function(e,n,o){var r=(e("function-widget-1:download/util/downloadCommonUtil.js"),e("base:widget/libs/jquerypacket.js")),t=e("base:widget/storage/storage.js"),s=e("function-widget-1:download/util/context.js").getContext,i={conf:{URL_GETBROWSERID:"/api/invoker/get",URL_CHECKONLINE:"/api/invoker/online",URL_SENDDATA:"/api/invoker/send",URL_CHEKCGUANJIA:"/api/invoker/check",CHECK_MAX_NUM:5,CHECK_NUM:5,CHECK_EVERY_TIME:2e3,browserId:null,isOnline:!1,guanjiaVersion:0},getBrowserIdByServer:function(e){r.ajax({url:i.conf.URL_GETBROWSERID,type:"GET",dataType:"json",success:function(n){n&&0===n.errno?(i.conf.browserId=n.browserId,t.setItem("browserId",n.browserId),s().log.send({name:"getBrowserIdByServer",value:"success"}),"function"==typeof e&&e(n.browserId)):(s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"getBrowserIdByServer",value:"failure"}))},error:function(){s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"getBrowserIdByServer",value:"failure"})}})},checkIsOnlineByServer:function(e,n){r.ajax({url:i.conf.URL_CHECKONLINE,type:"GET",data:{browserId:e},dataType:"json",success:function(e){e&&0===e.errno?(""!==e.version&&2!==e.online&&(i.conf.guanjiaVersion=e.version,i.conf.isOnline=1===e.online?!0:!1),s().log.send({name:"checkIsOnlineByServer",value:"success"}),"function"==typeof n&&n(e)):(s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"checkIsOnlineByServer",value:"failure"}))},error:function(){s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"checkIsOnlineByServer",value:"failure"})}})},sendDataByServer:function(e,n,o){r.ajax({url:i.conf.URL_SENDDATA,type:"POST",data:{browserId:e,downloadInfo:n},dataType:"json",success:function(e){"function"==typeof o&&o(e),s().log.send({name:"sendDataByServer",value:"success"})},error:function(){s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"sendDataByServer",value:"failure"})}})},checkGuanjiaStatusByServer:function(e,n,o){r.ajax({url:i.conf.URL_CHEKCGUANJIA,type:"GET",data:{browserId:e,seq:n},dataType:"json",success:function(r){0===r.errno?1===r.status?(i.conf.CHECK_NUM=i.conf.CHECK_MAX_NUM,"function"==typeof o&&o(e,n,r.status),s().log.send({name:"checkGuanjiaStatusByServer",value:"success"})):i.conf.CHECK_NUM>0?setTimeout(function(){i.checkGuanjiaStatusByServer(e,n,o),i.conf.CHECK_NUM--},i.conf.CHECK_EVERY_TIME):("function"==typeof o&&o(e,n,r.status),i.conf.CHECK_NUM=i.conf.CHECK_MAX_NUM):(s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"checkGuanjiaStatusByServer",value:"failure"}))},error:function(){s().ui.tip({mode:"caution",msg:"参数错误"}),s().log.send({name:"checkGuanjiaStatusByServer",value:"failure"})}})}};o.exports={init:function(e){i.conf.browserId=t.getItem("browserId"),i.conf.browserId?i.checkIsOnlineByServer(i.conf.browserId,e):i.getBrowserIdByServer(function(n){i.checkIsOnlineByServer(n,e)})},getBrowserId:function(){return i.conf.browserId},checkIsOnline:function(){return i.conf.isOnline},sendServer:function(e,n,o){i.sendDataByServer(e,n,o)},checkCallStatus:function(e,n,o){i.checkGuanjiaStatusByServer(e,n,o)},setVersion:function(e){i.conf.guanjiaVersion=e},getVersion:function(){return i.conf.guanjiaVersion}}});
;define("function-widget-1:download/util/interactionUtil.js",function(i,s,a){function e(){var i=/(HarmonyOS|OpenHarmony).*PC|PC.*(HarmonyOS|OpenHarmony)/i;return i.test(window.navigator.userAgent)}function t(){var i=1===+m().locals.get("is_svip"),s=1===+m().locals.get("is_vip"),a=[];return a.push('<div class="module-download-dialog">'),a.push('<div class="content">'),a.push('<div id="'+b._mMsgId+'_videoGuideBox" class="videoGuide">'),a.push('<div class="guideHeader"></div>'),a.push('<div class="guidePreview"></div>'),a.push("</div>"),a.push('<div id="'+b._mMsgId+'" class="message global-center">加载中&hellip;</div>'),a.push('<div id="'+b._mClientHintId+'" class="g-clearfix download-manage-client-hint g-center"></div>'),a.push('<div class="dlg-ft">'),a.push('<div class="g-clearfix g-center">'),a.push('<div class="videoBtnBox">'),a.push('<a href="javascript:void(0);" id="'+b._mPositiveVideoId+'" class="g-button g-button-large g-button-blue-large">'),a.push('<span class="g-button-right">'),a.push('<span class="text">'+(i?'<em class="d-svip-icon"></em>超级会员极速下载':s?'<em class="d-vip-icon"></em>会员高速下载':"高速下载（推荐）")+"</span>"),a.push("</span>"),a.push("</a>"),a.push('<a href="javascript:;" id="'+b._mNegativeVideoId+'" class="g-button g-button-large g-button-gray-large">'),a.push('<span class="g-button-right">普通下载</span>'),a.push('<i class="lineheight-ie7"></i>'),a.push("</a>"),a.push("</div>"),a.push('<div class="normalBtnBox">'),a.push('<a href="javascript:;" id="'+b._mPositiveId+'" node-type="download-speedup" class="g-button g-button-large g-button-blue-large">'),a.push('<span class="g-button-right">'),a.push('<span class="text">'+(i?'<em class="d-svip-icon"></em>超级会员极速下载':s?'<em class="d-vip-icon"></em>会员高速下载':"高速下载（推荐）")+"</span>"),a.push("</span>"),a.push("</a>"),y&&(a.push('<a href="javascript:void(0);" id="'+b._mPositiveId2+'" node-type="download-speedup" class="g-button g-button-large g-button-blue-large"> '),a.push('<span class="g-button-right"><span class="text">下载Linux版（deb格式）</span></span></span></a>')),a.push('<a href="javascript:;"  id="'+b._mNegativeId+'" node-type="download-normal" class="g-button g-button-large g-button-gray-large">'),a.push('<span class="g-button-right">'),a.push('<span class="text">普通下载</span>'),a.push("</span>"),a.push("</a>"),a.push("</div>"),a.push("</div>"),a.push("</div>"),a.push("</div>"),a.push('<div class="dlg-ft01 b-rlv" id="show-acceleration-pack">'),a.push('<div class="g-clearfix center acceleration-pack">'),a.push('<span class="dowmload-imgs-style dowmload-imgs-style01"></span>'),a.push('<span class="dowmload-content-style">还想更快？购买网络加速包，最高</span>'),a.push('<span class="download-upspeed-style">提速40%</span>'),a.push('        <a href="javascript:;" id="goToBuy" class="g-button-small g-button abtn download-change-link-style">'),a.push('            <b class="g-button-right">立即提速</b>'),a.push("        </a>"),a.push("</div>"),a.push("</div>"),a.push('<div class="dlg-ft01 b-rlv" id="show-buyvip-pack" style="display:none;">'),a.push('    <div class="g-clearfix center buyvip-pack">'),a.push('        <span class="dowmload-imgs-style dowmload-imgs-style01"></span>'),a.push('        <span class="dowmload-content-style">开通百度网盘超级会员，专享极速下载特权</span>'),a.push('        <a href="javascript:;" id="goToBuyVip" class="g-button-small g-button abtn download-change-link-style">'),a.push('            <b class="g-button-right">立即提速</b>'),a.push("        </a>"),a.push("    </div>"),a.push("</div>"),a.join("")}function o(i){var s="/rest/2.0/membership/isp?method=query";1===+m().locals.get("loginstate")&&(x.isVideo||h.ajax({url:s,type:"POST",data:{user_id:1},dataType:"json",success:function(s){"function"==typeof i&&i(s)}}))}function d(){if(1!==+m().locals.get("is_svip")){var i=m().locals.get("bind_info");if(!i||!i._isValid){var s=h("#show-buyvip-pack");s.length>0&&(s.fadeIn("200"),m().log.send({url:"//"+f+"/api/analytics",type:"download_buyvip_view"}))}}}function n(){var i=b.packName;return x.isNormalSingleFile?x.list[0].server_filename:1===x.list.length?i:i+"等（<strong>"+x.list.length+"</strong>）个文件"}function l(i){var s,a,e,t,o="",d=m().file.getIconAndPlugin,l="",p=navigator.userAgent.toLowerCase();/micromessenger/.test(p)&&(m().ui.tip({mode:"loading",msg:"若调起网盘客户端失败，请点击右上角使用默认浏览器重试",autoClose:!0}),m().log.send({type:"web_sharelist_shareid_clk_download_client_entry_wechat",value:"微信唤起网盘客户端失败"})),i===!0?(b.dialog.$dialog.find(".dialog-header-title").text("高速下载"),x.isVideo?o+='<p class="download-mgr-dialog-title"></p>':o='<p class="download-mgr-dialog-icon"></p><p class="download-mgr-dialog-title">百度网盘客户端</p>',o+='<p class="download-mgr-dialog-text">快速、稳定下载大文件，请使用百度网盘客户端下载，还支持断点续传哟~</p>'):(o='<span class="fileicon"></span>'+n(),l=n()),h("#"+b._mMsgId).attr({title:l}).html(o),t=h(".fileicon","#"+b._mMsgId),N[v.INDEX_OF_FILENUM]!==v.FILE_NUM_SINGLE?(e=x.list[0],s=m().file.getIconAndPlugin(e.path,1,!0,!1,e.share).smallIcon):(e=x.list instanceof Array?x.list[0]:x.list,1===e.isdir?s=d(e.path,1,!1,!1,e.share).smallIcon:(a=e.path,s=d(a,0).smallIcon)),t.addClass(s),t.css("margin-right","8px")}function p(){var i=N[v.INDEX_OF_FILESIZE]===v.FILE_SIZE_MORE_LIMIT,s=h("#"+b._mMsgId+"_videoGuideBox"),a=s.find(".guideHeader"),e=s.find(".guidePreview"),t=x.list[0],o=!1,d=h("#"+b._mPositiveVideoId).parent(),n=h("#"+b._mPositiveId).parent();h("span","#"+b._mNegativeVideoId).text("普通下载"),h(".g-button-right span","#"+b._mPositiveVideoId).html(1===+m().locals.get("is_svip")?'<em class="d-svip-icon"></em>超级会员极速下载':1===+m().locals.get("is_vip")?'<em class="d-vip-icon"></em>会员高速下载':"高速下载（推荐）"),h("#"+b._mPositiveVideoId).attr("href","javascript:;").css("display",""),h("#"+b._mPositiveId).parent().hide(),i?(b.videoGuideText="你下载的文件过大，请使用百度网盘客户端或点击预览在线观看",h("#"+b._mNegativeVideoId).css("display","none")):(b.videoGuideText="点击立即播放，无需下载即可在线观看视频",h("#"+b._mNegativeVideoId).css("display",""));var p=h('<a target="_blank" class="playLink" href="/play/video#/video?path='+encodeURIComponent(t.path)+'&t=-1"><div class="playBox"><i title="播放" class="playIcon"></i><span class="playText">点击播放</span></div></a>'),g="";t.thumbs&&t.thumbs.url2&&(g=t.thumbs.url2),e.html(p).attr("style","background:url("+g+") 50% 50% no-repeat").show(),i?a.html("<span>"+b.videoGuideText+"</span></div>").show():a.html('<div class="decorLine"></div><span>'+b.videoGuideText+'</span><div class="decorLine lineR"></div>').show(),b.fromVideoCall?(h(".text","#"+b._mPositiveVideoId).text("安装最新版网盘客户端"),h("#"+b._mNegativeVideoId).css("display","none"),o=!0):(m().log.send({page:I.getDownloadLogmsg(),url:"//"+f+"/api/analytics",type:"video_download_guide_window_"+(i?"1":"0")}),!i&&m().log.send({type:x.logMsg.category+"-"+x.logMsg.actionRecommendPlugin})),"postInstall"===b.mode?(d.hide(),n.show()):(d.show(),n.hide()),l(o)}function g(i){i?(h("#"+b._mMsgId+"_videoGuideBox").show(),h("#"+b._mPositiveVideoId).parent().show()):(h("#"+b._mMsgId+"_videoGuideBox").hide(),h("#"+b._mPositiveVideoId).parent().hide())}function c(i,s){u(i,s),b.dialog&&h("div.chromeUpgradeHelpTip",b.dialog.$dialog).remove(),g(x.isVideo),x.isVideo?p():(h("#"+b._mPositiveId).parent().show(),P[b.mode]())}function r(){b.dialog=m().ui.window({id:b.DIALOG_ID,title:"文件下载",body:t(),width:"568px"}),b.guanjiaDownloadUrl||_.getGuanjiaDownloadUrl(function(i){b.guanjiaDownloadUrl=i.url,b.guanjiaVersion=i.version}),o(function(i){var s=1===+m().locals.get("is_svip");i.isp_name&&""!==i.isp_name&&s?(b._mIspName=i.isp_name,h("#show-acceleration-pack").fadeIn("200"),m().log.send({page:I.getDownloadLogmsg(),url:"//"+f+"/api/analytics",type:"check_isp_name"})):d()})}function u(i,s){N=i,x=s,b.packName=x.packName,b.mode=x.mode}var m=i("function-widget-1:download/util/context.js").getContext,h=i("base:widget/libs/jquerypacket.js"),v=i("function-widget-1:download/config.js"),_=i("function-widget-1:download/util/downloadGuanjiaUtil.js"),I=i("function-widget-1:download/util/downloadCommonUtil.js"),w=/HarmonyOS|HuaweiBrowser|OpenHarmony|ArkWeb/i.test(window.navigator.userAgent),y=!e()&&String(navigator.platform).indexOf("Linux")>-1,f=window.host&&window.host.HOST_PAN||"pan.baidu.com",b={_mMsgId:disk.obtainId(),_mPositiveId:disk.obtainId(),_mPositiveId2:disk.obtainId(),_mNegativeId:disk.obtainId(),_mPositiveVideoId:disk.obtainId(),_mNegativeVideoId:disk.obtainId(),_mClientHintId:disk.obtainId(),_mDownloadTipsId:disk.obtainId(),dialog:null,DIALOG_ID:"moduleDownloadDialog",videoGuideText:"",_mIspName:null,mode:"",logMap:{preDownload:0,preInstall:1,postInstall:2,postRetry:3,directDownload:4}},x={},N=(b.logMap,""),P={preDownload:function(){var i=1===+m().locals.get("is_svip"),s=1===+m().locals.get("is_vip");b._mIspName&&i?h("#show-acceleration-pack").fadeIn("200"):i||d(),h("#"+b._mClientHintId).css("display","none"),h("#"+b._mMsgId).removeClass("download-mgr-tight"),l(),h(".g-button-right span","#"+b._mPositiveId).html(i?'<em class="d-svip-icon"></em>超级会员极速下载':s?'<em class="d-vip-icon"></em>会员高速下载':"高速下载（推荐）"),h("#"+b._mPositiveId).attr("href","javascript:;").css("display",""),h(".g-button-right","#"+b._mNegativeId).text("普通下载"),h("#"+b._mNegativeId).css("display",""),b.dialog.$dialog.find(".dialog-header-title").text("文件下载"),m().log.send({type:x.logMsg.category+"-"+x.logMsg.actionRecommendPlugin}),b.dialog.show()},preInstall:function(){var i=!0;h("#"+b._mMsgId).addClass("download-mgr-tight"),h("#"+b._mPositiveId).css("display","").attr("href","javascript:;"),h("#"+b._mPositiveId2).css("display",""),h("#"+b._mPositiveVideoId).css("display","").attr("href","javascript:;"),h(".text","#"+b._mPositiveId).text(y?"下载Linux版（rpm格式）":"安装最新版网盘客户端"),h(".text","#"+b._mPositiveVideoId).text("安装最新版网盘客户端"),h(".text","#"+b._mPositiveId).on("click",function(i){if(w){i.preventDefault();var s=e()?"https://appgallery.huawei.com/app/detail?id=com.baidu.netdisk.hmpc":"https://appgallery.huawei.com/app/detail?id=com.baidu.netdisk.hmos";window.open(s,"_blank")}}),h("#"+b._mNegativeId).css("display","none"),h("#"+b._mNegativeVideoId).css("display","none"),h("#"+b._mDownloadTipsId).css("display","none");var s=h("#"+b._mClientHintId);s.css("display","none"),b.dialog.$dialog.find(".dialog-header-title").text("文件下载"),v[v.INDEX_OF_FILENUM]===v.FILE_NUM_SINGLE?N[v.INDEX_OF_FILESIZE]===v.FILE_SIZE_MORE_LIMIT?(s.html("你下载的文件过大，请使用百度网盘客户端。").show(),i=!1):(h("#show-acceleration-pack").hide(),h("#show-buyvip-pack").hide(),s.html("").hide()):v[v.INDEX_OF_FILENUM]!==v.FILE_NUM_SINGLE?((N[v.INDEX_OF_FILESIZE]===v.FILE_SIZE_MORE_LIMIT||N[v.INDEX_OF_FILENUM]===v.FILE_NUM_MORE_100)&&(s.html("你下载的文件过大或者过多，请使用百度网盘客户端下载。").show(),i=!1),N[v.INDEX_OF_ISDIR]===v.FILE_HASDIR?(s.html("你下载的内容包含文件夹，请使用百度网盘客户端下载。").show(),i=!1):s.html("").hide()):s.html("").hide(),l(i),b.dialog.hide(),b.isVideoShow=!1},postInstall:function(i){"string"==typeof i&&(b.guanjiaDownloadUrl=i);var s=h("#"+b._mPositiveId),a=h("#"+b._mPositiveId2);y?(s.attr("href",b.guanjiaDownloadUrl[0]),a.attr("href",b.guanjiaDownloadUrl[1])):s.attr("href",b.guanjiaDownloadUrl),h("#"+b._mPositiveVideoId).attr("href",b.guanjiaDownloadUrl).css("display","none").parent().hide(),h("#"+b._mClientHintId).css("display","none"),h("#"+b._mMsgId).removeClass("download-mgr-tight").html("<p>安装完成后，重启浏览器即可高速下载</p>"),s.css("display","none"),a.css("display","none"),h("#"+b._mNegativeId).css("display","block"),h("#"+b._mNegativeVideoId).css("display",""),h("span","#"+b._mNegativeId).text("知道了"),h("span","#"+b._mNegativeVideoId).text("知道了"),s.parent().show(),m().locals.get("shareid","isPcShareIdWhiteList","loginstate","pcShareIdFrom",function(i,s,a,e){m().log.send({type:"web_sharelist_shareid_clk_download_client_entry",value:"web外链页-点击客户端下载："+b.guanjiaDownloadUrl,from:i,isLogin:a,isPcShareLink:s,pcShareIdFrom:e})}),b.dialog.show(),x.isVideo&&m().log.send({page:I.getDownloadLogmsg(),url:"//"+f+"/api/analytics",type:"video_download_guide_window_2"})}};r(),a.exports={state:b,updateDialog:c,initDialog:r,updateMap:P}});
;define('function-widget-1:download/service/axios/config.js', function(require, exports, module){ /**
 * @file
 */

function queryString(query) {
    if (typeof query === 'string') {
        return query;
    }

    var str = [];

    function seriliaize(data) {
        for (var n in data) {
            if (!data.hasOwnProperty(n)) {
                continue;
            }
            var value = data[n];
            // eslint-disable-next-line
            if (typeof value === 'function' || value === void 0) {
                continue;
            }
            if (Object.prototype.toString.call(value) === '[object Object]') {
                seriliaize(value);
            } else {
                str.push(encodeURIComponent(n) + '=' + encodeURIComponent(value));
            }
        }
    }

    seriliaize(query);

    return str.join('&');
}

var CONFIG = {
    // timeout: 5000,
    baseURL: '',
    headers: {
        post: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        common: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    },
    responseType: 'json',
    transformRequest: [function (data, config) {
        if (typeof data === 'string') {
            return data;
        }

        var contentType = config['Content-Type'] || (config.headers && config.headers['Content-Type']);

        if (/\bapplication\/json\b/i.test(contentType)) {
            return JSON.stringify(data);
        }
        if (/\bmultipart\/form-data\b/.test(contentType)) {
            return data;
        }
        return queryString(data);
    }],
    validateStatus() {
        return true;
    }
};

module.exports = CONFIG;
 
});
;define('function-widget-1:download/service/guanjiaDownloadController.js', function(require, exports, module){ /**
 * @author zhangyuliang02
 * @version [v1.0] 2018-04-03
 * @description 管家下载入口
 */
var downloadCommonUtil = require('function-widget-1:download/util/downloadCommonUtil.js');
var downloadGuanjiaUtil = require('function-widget-1:download/util/downloadGuanjiaUtil.js');
var downloadConfig = require('function-widget-1:download/config.js');
var getContext = require('function-widget-1:download/util/context.js').getContext;
var guanjiaConnector = require('function-widget-1:download/service/guanjiaConnector.js');
var guanjiaServerProxy = require('function-widget-1:download/service/guanjiaServerProxy.js');
var dlinkService = require('function-widget-1:download/service/dlinkService.js');
var interaction = require('function-widget-1:download/util/interactionUtil.js');
var axiosCfg = require('function-widget-1:download/service/axios/config.js');
var $ = require('base:widget/libs/jquerypacket.js');
var uk = window.locals.get('uk');

var axiosIns;
var downloadKey = '';
var options = {};
var state = {
    loadingTips: null,
    guanjiaVersion: null,
    first: true,

    GUANJIA_VERSION_COMPARE: '4.8.0',
    MAX_CHECK_COUNT: 3
};
var callLocal = false;

var doCallGuanjiaForShare = (function () {
    var callOldGuanjiaForShare = function (instance, shareId, shareUk, opts) {
        shareUk = shareUk ? shareUk + '' : '0';
        var guanjiaList = [],
            sigleFilefsIds = [],
            me = instance,
            info,
            bdclndTokenFromCookie = getContext().tools.baseService.getCookie('BDCLND');

        // 格式化数据
        var item = null;

        for (var i = 0, len = options.list.length; i < len; i++) {
            info = {};
            item = options.list[i];
            info['isdir'] = String(item.isdir);
            info['md5'] = item.md5 || '';
            info['size'] = String(item.size || 0);
            info['server_path'] = item.path;
            info['uk'] = '';
            info['shareid'] = '';
            info['token'] = '';
            info['fs_id'] = item.fs_id;

            if (item.dlink || item.isdir) {
                info['link'] = item.dlink && downloadCommonUtil.getDownloadUrl(item) || '';
            } else {
                sigleFilefsIds.push(item.fs_id);
            }
            guanjiaList.push(info);
        }

        if (sigleFilefsIds.length > 0) {
            getContext().ui.tip({
                mode: 'loading',
                msg: '正在获取下载链接，请稍候...'
            });

            dlinkService.getDlinkShare(opts || options, function (data) {
                getContext().ui.hideTip();
                // 判断data.list是否为字符串
                if (data.list && _.isString(data.list)) {
                    callGuanjia(undefined, data.list);
                } else {
                    callGuanjia(downloadGuanjiaUtil.getFormatedLinkList(guanjiaList, data.list));
                }
            });
        } else {
            getContext().locals.get('share_uk', 'shareid', 'sign', 'timestamp',
                function (uk, shareid, sign, servertime) {
                    // $.get('/share/autoincre', {
                    //     type: 1,
                    //     uk: uk,
                    //     shareid: shareid,
                    //     sign: sign,
                    //     timestamp: servertime
                    // });
                });
            callGuanjia(guanjiaList);
        }
    };

    return function (obj) {
        // 采用原有方式下载
        if (downloadCommonUtil.isPlatformWindows() && state.guanjiaVersion < state.GUANJIA_VERSION_COMPARE) {
            getContext().locals.get('shareid', 'share_uk', function (shareid, uk) {
                callOldGuanjiaForShare(options, shareid, uk, obj);
            });
        } else {
            getContext().ui.tip({
                mode: 'loading',
                msg: '正在获取下载链接，请稍候...',
                autoClose: false
            });

            options.isForGuanjia = true;
            dlinkService.getDlinkShare(obj || options, function (data) {
                getContext().ui.hideTip();
                callGuanjia(undefined, data.list);
            });
        }
    };
})();

function callGuanjiaLocalByProduct() {
    var product = downloadKey[downloadConfig.INDEX_OF_PRODUCT];
    var doMap = {};
    doMap[downloadConfig.PRODUCT_SHARE] = doCallGuanjiaForShare;
    doMap[downloadConfig.PRODUCT_PAN] = callGuanjiaInPan;
    doMap[downloadConfig.PRODUCT_UNIONDIR] = callGuanjiaInUnionDir;
    options.ct = 'pcygj';
    options.cv = state.guanjiaVersion;
    state.loadingTips = loadingTips = getContext().ui.tip({
        msg: '正在启动网盘客户端，请稍候...',
        mode: 'loading',
        autoClose: false
    });
    callLocal = true;
    doMap[product]();
    getContext().log.send({
        'name': 'callGuanjia',
        'value': 'success'
    });
}

function callGuanjiaInUnionDir() {
    getContext().locals.get('uk', 'sign1', 'timestamp', function (uk, sign1, servertime) {
        var shareId = options.list[0].fs_id;
        // TODO 共享目录调云管家都必须加密 isForGuanjia设置为true
        doCallGuanjiaForShare({
            path: options.list,
            product: 'sf',
            hasDlink: true,
            share_uk: uk,
            share_id: shareId,
            sign: sign1,
            timestamp: servertime,
            // TODO 外链不能用batch 否则只返回dlink，而没有fileMetas 云管家解析不了。
            isForBatch: false,
            isForGuanjia: true
        });
    });
}

function callGuanjiaInPan() {
    /**
     * 当下载多文件的时候，需要做以下判断
     *
     * 1> 如果这些文件都是单文件，那么需要获取对应dlink，再去调用云管家
     * 2> 其他情况，直接调用云管家
     */

    var guanjiaList = [],
        sigleFilefsIds = [],
        info;
    // 格式化数据
    var item = null;

    for (var i = 0, len = options.list.length; i < len; i++) {
        info = {};
        item = options.list[i];
        info['isdir'] = String(item.isdir);
        info['md5'] = item.md5 || '';
        info['size'] = String(item.size || 0);
        info['server_path'] = item.path;
        info['uk'] = '';
        info['shareid'] = '';
        info['token'] = '';
        info['fs_id'] = item.fs_id;

        if (item.dlink || item.isdir) {
            info['link'] = item.dlink && downloadCommonUtil.getDownloadUrl(item) || '';
        } else {
            sigleFilefsIds.push(item.fs_id);
        }
        guanjiaList.push(info);
    }
    if (sigleFilefsIds.length > 0) {
        getContext().ui.tip({
            mode: 'loading',
            msg: '正在获取下载链接，请稍候...',
            autoClose: false
        });
        var needHidden = options.list.every(function (item) {
            return !!item.needHidden;
        });
        var otherParam = {};
        if (needHidden) {
            otherParam.src = 'xpan';
        }
        dlinkService.getDlinkPan(dlinkService.getFsidListData(options.list), 'dlink', function (data) {
            if (data.errno === 0) {
                getContext().ui.hideTip();
                guanjiaList = downloadGuanjiaUtil.getFormatedLinkList(guanjiaList, data.dlink);
                callGuanjia(guanjiaList);
            }
        }, 'pcygj', state.guanjiaVersion, undefined, otherParam);
    } else {
        callGuanjia(guanjiaList);
    }
}

/**
 * 初始化遍历管家插件，判断是否具有管家插件
 * @description 用hook方式和本地代理模式调起云管家的探测逻辑（不包含serverproxy代理模式）
 */
function checkGuanjiaLocal() {
    state.guanjiaVersion = guanjiaConnector.getVersion();
    if (state.guanjiaVersion) {
        callGuanjiaLocalByProduct();
    } else {
        // 管家没开
        if ($('div.chromeUpgradeHelpTip', state.dialog.$dialog).length === 0) {
            var chromeUpgradeHelpTip = $('<div class="chromeUpgradeHelpTip" '
                + 'style="text-align: center;position:relative;margin-bottom:10px;">已安装新版客户端，'
                + '<a style="color:#09AAFF;" href="javascript:void(0);" class="local_retry">'
                + '点此启动客户端开始下载' + '</a>（已启动，'
                + '<a style="color:#fc6258;text-decoration:underline;" href="/disk/help#FAQ18" target="_blank">'
                + '仍无法下载？' + '</a>）</div>');
            $('div.dlg-ft', state.dialog.$dialog).after(chromeUpgradeHelpTip);
            $('div.chromeUpgradeHelpTip a.local_retry').bind('click', function () {
                downloadCommonUtil.openYunGuanjiaByScheme('baiduyunguanjia://guanjia/noui', function () {
                    // 如果连接成功，开始下载
                    state.MAX_CHECK_COUNT = 7;
                    state.checkCount = state.MAX_CHECK_COUNT;
                    state.mode = 'preInstall';
                    interaction.updateDialog(downloadConfig, options);
                    checkGuanjiaLocal();
                });
                return false;
            });
        }

        if (state.checkCount > 0) {
            if (state.checkCount === state.MAX_CHECK_COUNT) {
                // 初始化连接器
                if (state.MAX_CHECK_COUNT === 3) {
                    guanjiaConnector.init()
                } else {
                    guanjiaConnector.init(true)
                }
                state.loadingTips = getContext().ui.tip({
                    msg: '正在启动网盘客户端，请稍候...',
                    mode: 'loading',
                    autoClose: false
                });
            }
            state.checkCount--;
            setTimeout(function () {
                // 如果连接成功，开始下载
                // interaction.updateDialog(downloadConfig, options);
                checkGuanjiaLocal();
            }, 500);
        } else if (state.first) {
            state.first = false;
            downloadCommonUtil.openYunGuanjiaByScheme('baiduyunguanjia://guanjia/noui', function () {
                // 如果连接成功，开始下载
                state.MAX_CHECK_COUNT = 7;
                state.checkCount = state.MAX_CHECK_COUNT;
                // interaction.updateDialog(downloadKey, options);
                checkGuanjiaLocal();
            });
        } else {
            state.dialog.show();
            state.loadingTips.hide();
            state.mode = 'postInstall';
            // 下一次支持重新scheme调端
            state.first = true;
            getContext().log.send({
                'name': 'callGuanjia',
                'value': 'failure'
            });
        }
        // 2 cases of incoming call
        getContext().log.send({
            page: downloadCommonUtil.getDownloadLogmsg(),
            type: (downloadKey[downloadConfig.INDEX_OF_FILENUM] === downloadConfig.FILE_NUM_SINGLE && downloadKey[downloadConfig.INDEX_OF_FILESIZE] === downloadConfig.FILE_SIZE_MORE_LIMIT)
                ? 'DownloadPluginDisplayForceHugeOptions' : 'DownloadPluginDisplayForceNonhugeOptions'
        });
    }
}

function checkGuanjiaServer() {
    guanjiaServerProxy.init(function (data) {
        state.guanjiaVersion = guanjiaServerProxy.getVersion();
        callGuanjiaServerByProduct();
    });
}

function callGuanjiaLocal(list, guanjiaString) {
    // var guanjiaVersion = state.guanjiaVersion;
    var fileListParams;
    var rlt;
    var isInShareDir = false;
    var product = downloadKey[downloadConfig.INDEX_OF_PRODUCT];
    var doMap = {};


    doMap[downloadConfig.PRODUCT_SHARE] = function () {
        var isSharePage = getContext().pageInfo.currentProduct === 'share';
        var isTinyVersion = downloadCommonUtil.isPlatformWindows()
            && !downloadCommonUtil.compareVersion(state.guanjiaVersion, state.GUANJIA_VERSION_COMPARE);

        try {
            // 如果小于新版本，采用原有方式调用管家
            if (isSharePage && isTinyVersion) {
                fileListParams = $.stringify({'filelist': list});
                rlt = guanjiaConnector.callGuanjia(getContext().locals.get('public') === 0
                    ? 'DownloadPrivateShareItems' : 'DownloadPublicShareItems', fileListParams);
            } else if (guanjiaString) {
                // >=新版本 - 传递参数-用户uk
                rlt = guanjiaConnector.callGuanjia('DownloadShareItems', guanjiaString, uk, isInShareDir);
            } else {
                rlt = 2;
            }
            if (rlt < 0) {
                downloadGuanjiaUtil.doError(rlt);
            }
        } catch (e) {
            rlt = -2;
            downloadGuanjiaUtil.doError(rlt);
        }
    };
    // 共享目录调起方式与外链相同
    doMap[downloadConfig.PRODUCT_UNIONDIR] = doMap[downloadConfig.PRODUCT_SHARE];
    doMap[downloadConfig.PRODUCT_PAN] = function () {
        fileListParams = $.stringify({'filelist': list});
        try {
            // 如果小于新版本，采用原有方式调用管家 - 传递参数-用户名
            if (downloadCommonUtil.isPlatformWindows()
                && !downloadCommonUtil.compareVersion(state.guanjiaVersion, state.GUANJIA_VERSION_COMPARE)) {
                rlt = guanjiaConnector.callGuanjia('DownloadSelfOwnItems',
                    fileListParams, getContext().locals.get('username'));
            } else {    // >=新版本 - 传递参数-用户uk
                rlt = guanjiaConnector.callGuanjia('DownloadSelfOwnItems', fileListParams, uk + '');
            }
            if (rlt < 0) {
                downloadGuanjiaUtil.doError(rlt);
            }
        } catch (e) {
            rlt = -2;
            downloadGuanjiaUtil.doError(rlt);
        }
    };
    if (state.loadingTips) {
        setTimeout(function () {
            state.loadingTips.hide();
        }, 5000);
    }

    getContext().log.send({
        'name': 'call_guanjia_local',
        'value': '下载本地服务调起'
    });
    doMap[product]();
}

function sendLog(type, value) {
    getContext().log.send({
        type: type,
        value: value
    });
}
var prefixType = 'web_share_downloadSDK_';
var prefixValue = 'web外链SDK调端下载_';

function callGuanjiaServerByProduct() {
    var doMap = {};
    var product = downloadKey[downloadConfig.INDEX_OF_PRODUCT];
    var hasShare = downloadCommonUtil.hasShare(options.list);
    if (options.list.length === 1 && +options.list[0].category === 1) {
        getContext().log.send({
            type: 'download_video_widget_guanjia',
            from: hasShare ? 'share' : ''
        });
    }
    // 多条下载数据，含有视频文件
    if (options.list.length > 1 && downloadCommonUtil.judgeVideo(options.list, true)) {
        getContext().log.send({
            type: 'more_download_video_widget_guanjia',
            from: hasShare ? 'share' : '',
            allVideo: !downloadCommonUtil.judgeVideo(options.list, false)
        });
    }
    doMap[downloadConfig.PRODUCT_SHARE] = function () {
        // 外链下载
        getContext().ui.tip({
            mode: 'loading',
            msg: '正在获取下载链接，请稍候...',
            autoClose: false
        });

        options.isForGuanjia = true;
        var browserSupport = !!(window.Object && window.Object.assign && window.Promise);
        if (getContext().pageInfo.currentSubProduct !== 'doc-share' && browserSupport) {
            var random = '?t=' + Date.now();
            var downloadUrl = '//nd-static.bdstatic.com/m-static/wp-download/wp-upload.0.0.0-beta.11.umd.js' + random;
            var axiosUrl = '//nd-static.bdstatic.com/m-static/base/thirdParty/vue/axios.js' + random;
            Promise.all([loadScript(downloadUrl, 'wp-download'), loadScript(axiosUrl, 'wp-download-axios')]).then(() => {
                var WpDownloader = window['wp-download'];
                var Axios = window.require('base:thirdParty/vue/axios.js');
                if (WpDownloader && Axios) {
                    if (!axiosIns) {
                        axiosIns = Axios.create(axiosCfg);
                        axiosIns.interceptors.response.use(function (response) {
                            if (response.status !== 200 || !response.data) {
                                return Promise.reject('axios no 200 error');
                            }
                            return response.data;
                        }, function (error) {
                            return Promise.reject(error);
                        });
                    }
                    var downCfg = {
                        fileList: options.list,
                        extra: {
                            share_uk: options.share_uk,
                            share_url: window.location.href,
                            share_id: options.share_id,
                            timestamp: options.timestamp,
                            sign: options.sign,
                            vcode_input: '',
                            vcode_str: ''
                        },
                        product: 'share'
                    };
                    var downloader = new WpDownloader({
                        http: axiosIns,
                        uk: uk,
                        bizConfig: {
                            nativeParam: {
                                src_from: 'wp-download_web_share',
                                src_type: 'web_sharelink_page'
                            },
                            start: function () {
                                sendLog(prefixType + 'Start', prefixValue + '开始');
                            },
                            progress: function (step) {
                                switch (step) {
                                    case 'perConnSendSuc':
                                        sendLog(prefixType + 'perConnInvokeSuccess', prefixValue + '长链接调端成功');
                                        break;
                                    case 'perConnSendFail':
                                        sendLog(prefixType + 'perConnInvokeFail', prefixValue + '长链接调端失败');
                                        break;
                                    case 'appLocalHttpsSuc':
                                        sendLog(prefixType + 'httpsInvokeSuccess', prefixValue + 'https调端成功');
                                        break;
                                    case 'appLocalHttpsFail':
                                        sendLog(prefixType + 'httpsInvokeFail', prefixValue + 'https调端失败');
                                        break;
                                    case 'schemaPollSuc':
                                        sendLog(prefixType + 'schemaInvokeSuccess', prefixValue + 'schema调端成功');
                                        break;
                                    case 'schemaPollFail':
                                        state.dialog.show();
                                        state.mode = 'postInstall';
                                        if (state.loadingTips) {
                                            state.loadingTips.hide();
                                        }
                                        sendLog(prefixType + 'schemaInvokeFail', prefixValue + 'schema调起失败_最终失败');
                                        getContext().ui.hideTip();
                                        break;
                                    default:
                                        break;
                                }
                            },
                            end: function () {
                                getContext().ui.hideTip();
                            },
                            error: function (msg) {
                                getContext().ui.tip({
                                    mode: "caution",
                                    msg: msg
                                });
                            },
                            verifyCode: function () {
                                sendLog(prefixType + 'showVerifyCodeDisplay', prefixValue + '出现验证码');
                                var afterSure = function(vcode, input) {
                                    downCfg.extra.vcode_input = input;
                                    downCfg.extra.vcode_str = vcode;
                                    downloader.download(downCfg);
                                };
                                dlinkService._showVerifyDialog(afterSure);
                            }
                        }
                    });
                    delete downCfg.extra.vcode_input;
                    delete downCfg.extra.vcode_str;
                    downloader.download(downCfg);
                }
            }).catch(function () {
                getContext().ui.tip({
                    mode: 'caution',
                    msg: '初始化下载脚本出错，请稍后重试&hellip;',
                    autoClose: true,
                    hasClose: false
                });
            });
        } else {
            dlinkService.getDlinkShare(options, function (data) {
                getContext().ui.hideTip();
                callGuanjiaServer(undefined, data.list);
            });
        }
    };

    doMap[downloadConfig.PRODUCT_PAN] = function () {
        // 这里是盘内下载
        // 如果是视频，一定会弹起弹窗
        // zhangyuliang02：视频一定会弹窗，那下载一定来自层内点击，这个判断没意义啊，本次重构要消灭所有fromBtnClick，再见
        // if (!options.isVideo || state.fromBtnClick) {
        //     callGuanjiaInPan();
        // }
        callGuanjiaInPan();
    };

    doMap[downloadConfig.PRODUCT_UNIONDIR] = callGuanjiaInUnionDir;

    doMap[product]();
    if (state.loadingTips) {
        state.loadingTips.hide();
    }
}

function callGuanjiaServer(list, guanjiaString) {
    var browserId = guanjiaServerProxy.getBrowserId();
    var downloadInfo = {};
    var infoMap = {};
    var product = downloadKey[downloadConfig.INDEX_OF_PRODUCT];
    var src_from = window.locals.get('pcShareIdFrom') || '';
    infoMap[downloadConfig.PRODUCT_SHARE] = {
        'method': 'DownloadShareItems',
        // 容云管家外链长连接调起校验Uk字符串为空时的异常
        'uk': uk,
        'checkuser': false,
        'filelist': guanjiaString
    };
    if (src_from) {
        infoMap[downloadConfig.PRODUCT_SHARE].src_from = src_from;
    }

    infoMap[downloadConfig.PRODUCT_PAN] = {
        'method': 'DownloadSelfOwnItems',
        'uk': uk,
        'filelist': list
    };

    // 共享目录
    if (downloadCommonUtil.checkIsShare()) {
        downloadInfo = {
            'method': 'DownloadShareItems',
            // 容云管家外链长连接调起校验Uk字符串为空时的异常
            'uk': uk,
            'checkuser': true,
            'filelist': guanjiaString
        };
    } else {
        downloadInfo = infoMap[product];
    }

    if ($('div.chromeUpgradeHelpTip', state.dialog.$dialog).length === 0) {
        var chromeUpgradeHelpTip = $('<div class="chromeUpgradeHelpTip" '
            + 'style="text-align: center;position:relative;margin-bottom:10px;">已安装新版客户端，仍无法下载，'
            + '<a style="color:#fc6258;" href="/disk/help#FAQ18" target="_blank">'
            + '查看原因' + '</a></div>');
        $('div.dlg-ft', state.dialog.$dialog).after(chromeUpgradeHelpTip);
    }
    if (!downloadInfo.uk) {
        downloadInfo.uk = '0';
    }
    if (downloadInfo && typeof downloadInfo.uk === 'number') {
        downloadInfo.uk += '';
    }
    guanjiaServerProxy.sendServer(browserId, $.stringify(downloadInfo), function (data) {
        var failTryLocal = function () {
            checkGuanjiaLocal();
        };
        getContext().log.send({
            type: 'web_3_invoker_send',
            value: 'web下载调端_invoker_send'
        });
        if (data && data.errno === 0) {
            state.loadingTips = getContext().ui.tip({
                msg: '正在启动网盘客户端，请稍候...',
                mode: 'loading',
                autoClose: false
            });
            getContext().log.send({
                type: 'web_3_invoker_send_succ',
                value: 'web下载调端_invoker_send_succ'
            });
            var seq = data.seq;
            var status = data.status;
            if (status === 0) {
                // 表示设备在线，push下发成功同时端上给了ack, 调起成功，这样情况下端可以不用轮训调起状态接口
                // 成功调起
                state.loadingTips.hide();
                getContext().log.send({
                    'name': 'callGuanjiaByServer',
                    'value': 'success'
                });
                getContext().log.send({
                    type: 'web_3_invoker_send_0',
                    value: 'web下载调端_invoker_send_0'
                });
            } else if (status === 1) {
                // 表示设备在线，push成功，但端上在指定时间没有给ack, 需要轮询方法调用
                getContext().log.send({
                    type: 'web_3_invoker_send_1',
                    value: 'web下载调端_invoker_send_1'
                });
                guanjiaServerProxy.checkCallStatus(browserId, seq, function (browserId, seq, checkstatus) {
                    if (checkstatus === 1) {
                        // 调起成功提示隐藏
                        state.loadingTips.hide();
                        getContext().log.send({
                            type: 'web_3_invoker_send_1_succ',
                            value: 'web下载调端_invoker_send_1_succ'
                        });
                    }
                    if (checkstatus === 2) {
                        state.loadingTips.hide();
                        // 弹框调起失败
                        failTryLocal();
                        // state.dialog.show();
                        state.mode = 'postInstall';
                        getContext().log.send({
                            type: 'web_3_invoker_send_1_fail',
                            value: 'web下载调端_invoker_send_1_fail'
                        });
                    }
                });
            } else if (status === 2 || status === 3) {
                // 对应设备不在线，需要自有协议调起传参数注册（第一次注册broswerId绑定deviceId）或  未安装管家
                getContext().log.send({
                    type: 'web_3_invoker_send_23_scm',
                    value: 'web下载调端_invoker_send_scm'
                });
                var callClientSchema = 'baiduyunguanjia://evoked-download/?browserId=' + browserId + '&seq=' + seq;
                if (src_from) {
                    callClientSchema += '&src_from=' + src_from;
                }
                downloadCommonUtil.openYunGuanjiaByScheme(callClientSchema, function (data) {
                    guanjiaServerProxy.checkCallStatus(browserId, seq, function (browserId, seq, checkstatus) {
                        if (checkstatus === 1) {
                            // 调起成功提示隐藏
                            state.loadingTips.hide();
                            getContext().log.send({
                                type: 'web_3_invoker_send_23_scm_succ',
                                value: 'web下载调端_invoker_send_scm_succ'
                            });
                        }
                        if (checkstatus === 2) {
                            // 弹框调起失败
                            state.loadingTips.hide();
                            failTryLocal();
                            // state.dialog.show();
                            state.mode = 'postInstall';
                            getContext().log.send({
                                type: 'web_3_invoker_send_23_scm_fail',
                                value: 'web下载调端_invoker_send_scm_fail'
                            });
                        }
                    });
                });
            } else {
                // 服务器内部错误
                state.loadingTips && state.loadingTips.hide();
                failTryLocal();
                getContext().ui.tip({
                    mode: 'caution',
                    msg: '服务器繁忙，请稍后重试'
                });
                getContext().log.send({
                    'name': 'callGuanjiaByServer',
                    'value': 'failure'
                });
                getContext().log.send({
                    type: 'web_3_invoker_status_fail',
                    value: 'web下载调端_invoker_send_status_fail'
                });
            }
        } else {
            state.loadingTips && state.loadingTips.hide();
            // 服务器内部错误
            failTryLocal();
            getContext().ui.tip({
                mode: 'caution',
                msg: '参数错误'
            });

            getContext().log.send({
                'name': 'callGuanjiaByServer',
                'value': 'failure'
            });
            getContext().log.send({
                type: 'web_3_invoker_send_fail',
                value: 'web下载调端_invoker_send_fail'
            });
        }
        getContext().log.send({
            'name': 'call_guanjia_server',
            'value': '下载长连接方式调起'
        });
    });
}

function callGuanjia(list, guanjiaString) {
    callLocal ? callGuanjiaLocal(list, guanjiaString) : callGuanjiaServer(list, guanjiaString);
    callLocal = false;
}

function loadScript(src, id) {
    if (!window.Promise) {
        console.warn('Promise is not supported');
        return;
    }
    if (id && $('#' + id).length) {
        return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
        var script = null;
        var head = document.getElementsByTagName('head')[0];
        script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = src;
        script.id = id;
        try {
            script.onerror = reject;
        } catch (e) {
            console.log(e);
        }
        if (window.attachEvent) {
            script.onreadystatechange = function () {
                var r = script.readyState;
                if (r === 'loaded' || r === 'complete') {
                    script.onreadystatechange = null;
                    resolve();
                }
            };
        } else {
            script.onload = resolve;
        }
        head.appendChild(script);
    });
}

module.exports = {
    start: function (key, opts) {
        downloadKey = key;
        options = opts;
        // 尝试调起次数
        state.checkCount = state.MAX_CHECK_COUNT;
        // 同步state对象
        for (var k in state) {
            if (options.state) {
                options.state[k] = state[k];
            } else {
                interaction.state[k] = state[k];
            }
        }
        state = options.state ? options.state : interaction.state;
        state.mode = 'preInstall';
        options.mode = state.mode;
        // 初始化对话框为安装最新对话框, 视频调起管家必须通过对话框，故无需初始化
        interaction.updateDialog(downloadKey, options);

        if (downloadKey[downloadConfig.INDEX_OF_FILESIZE] === downloadConfig.FILE_SIZE_MORE_LIMIT) {
            getContext().log.send({
                page: downloadCommonUtil.getDownloadLogmsg(),
                type: options.logMsg.category + '-' + options.logMsg.actionCompulsoryPlugin
            });
        }
        state.dialog.hide();
        checkGuanjiaServer();
    }
};
 
});
;define("function-widget-1:download/service/dialogDownload.js",function(e,o,t){function i(){_.dialog.isInitEvent||(_.dialog.isInitEvent=!0,l()),c.updateDialog(I,u),_.dialog.show()}function l(){var e=r("#"+_.DIALOG_ID),o=r("#goToBuyVip"),t=window.host&&window.host.HOST_PAN||"pan.baidu.com";e.delegate("#"+_._mPositiveId,"click",function(){_.dialog.hide(),"postInstall"===_.mode?(n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionDownloadClient}),c.updateMap.postInstall()):(_.mode="preInstall",u.state=_,d.start(I,u),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionAccelerateDownload,fileSize:p.getFileSizeType(u.list)}))}),e.delegate("#"+_._mPositiveId2,"click",function(){_.dialog.hide(),"postInstall"===_.mode?(n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionDownloadClient}),c.updateMap.postInstall()):(_.mode="preInstall",u.state=_,d.start(I,u),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionAccelerateDownload,fileSize:p.getFileSizeType(u.list)}))}),e.delegate("#"+_._mNegativeId,"click",function(){var e=r("#"+_._mPositiveVideoId);if(e.attr("href").indexOf("javascript")>-1){if("share"===n().pageInfo.currentProduct&&!n().locals.get("loginstate"))return window.yunHeader.login.util.loginNew(),window.yunHeader.on("loginSuccess",function(){w.setItem("shareAutoDownload","1")}),!1;g.start(I,u),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionOrdinaryDownload,fileSize:p.getFileSizeType(u.list)})}else e.attr("href","javascript:;"),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionDownReportIssue});return _.dialog.hide(),!1}),e.delegate("#"+_._mPositiveVideoId,"click",function(){var e=y[_.mode];n().log.send({url:"//"+t+"/api/analytics",type:"video_download_guide_positive_"+e}),_.dialog.hide(),"postInstall"===_.mode?(n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionDownloadClient}),c.updateMap.postInstall()):(_.fromVideoCall=!0,u.state=_,d.start(I,u),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionAccelerateDownload,fileSize:p.getFileSizeType(u.list)}))}),e.delegate("#"+_._mNegativeVideoId,"click",function(){u.state=_,g.start(I,u),_.dialog.hide(),n().log.send({url:"//"+t+"/api/analytics",type:"video_download_guide_negative_0"}),n().log.send({page:p.getDownloadLogmsg(),type:u.logMsg.category+"-"+u.logMsg.actionOrdinaryDownload,fileSize:p.getFileSizeType(u.list)})}),e.delegate(".playLink","click",function(){_.dialog.hide(),n().log.send({url:"//"+t+"/api/analytics",type:"video_download_guide_playclick_"+y[_.mode]})}),e.delegate("#goToBuy","click",function(){return n().log.send({url:"//"+t+"/api/analytics",type:"cilick_isp_buy"}),window.open("/buy/center?tag=2&frm=dl#network"),!1}),o.click(function(){return n().log.send({url:"//"+t+"/api/analytics",type:"download_buyvip_click"}),window.open("//"+t+"/buy/checkoutcounter?svip=1&from=download_buyvip_click"),!1})}function a(e){var o=e,t="";return t=o[s.INDEX_OF_FILENUM]!==s.FILE_NUM_SINGLE?o[s.INDEX_OF_FILENUM]===s.FILE_NUM_MORE_100||o[s.INDEX_OF_FILESIZE]===s.FILE_SIZE_MORE_LIMIT||o[s.INDEX_OF_ISDIR]===s.FILE_HASDIR?"preInstall":"preDownload":o[s.INDEX_OF_ISDIR]===s.FILE_HASDIR?"preInstall":o[s.INDEX_OF_FILETYPE]===s.FILE_TYPE_CHROMEAPKEXE?"preInstall":o[s.INDEX_OF_FILESIZE]===s.FILE_SIZE_LESS_SMALL?"directDownload":o[s.INDEX_OF_FILESIZE]===s.File_SIZE_BETWEEN_SMALL_AND_LIMIT?"preDownload":"preInstall"}var n=e("function-widget-1:download/util/context.js").getContext,g=e("function-widget-1:download/service/downloadDirect.js"),d=e("function-widget-1:download/service/guanjiaDownloadController.js"),s=e("function-widget-1:download/config.js"),c=e("function-widget-1:download/util/interactionUtil.js"),r=e("base:widget/libs/jquerypacket.js"),p=(e("base:widget/small-flow/small-flow-util.js"),e("function-widget-1:download/util/downloadCommonUtil.js")),w=e("base:widget/storage/storage.js"),I="",u={},_=c.state,y=_.logMap;t.exports={start:function(e,o){u=o,I=e,_.mode=a(e),_.fromVideoCall=!1,u.mode=_.mode,i()},initDialogEvent:function(e,o){u=o,I=e,_.dialog.isInitEvent||(_.dialog.isInitEvent=!0,l())}}});
;define('function-widget-1:download/controller/downloadController.js', function(require, exports, module){ /**
 * @author zhangyuliang02
 * @version [v1.0] 2018-04-03
 * @description 下载的入口
 */

var $ = require('base:widget/libs/jquerypacket.js');
var _ = require('base:widget/libs/underscore.js');
var downloadDirect = require('function-widget-1:download/service/downloadDirect.js');
var downloadGuanjiaController = require('function-widget-1:download/service/guanjiaDownloadController.js');
var downloadDialog = require('function-widget-1:download/service/dialogDownload.js');
var downloadCommonUtil = require('function-widget-1:download/util/downloadCommonUtil.js');
var downloadConfig = require('function-widget-1:download/config.js');
var getContext = require('function-widget-1:download/util/context.js').getContext;
var storage = require('base:widget/storage/storage.js');
var BpABTest = require('base:widget/ab/ab.js');

var directDownloadkeys = [];
var guanjiaDownloadkeys = [];
var dialogDownloadkeys = [];
var downloadkey = '';
var defaultDownloadLimitObj = {
    url: '/disk/cmsdata',
    data: {
        'do': 'manual',
        'ch': 'download_limit',
    }
};

function getAbWebLimit() {
        return BpABTest.getInfoByKey('filesize_web_for_diaoduan')
        .then(function(abRes) {
            var enable = Boolean(+abRes);
            var downloadLimitObj = defaultDownloadLimitObj;

            if (enable) {
                downloadLimitObj = {
                    url: '/api/getsyscfg?version=1&cfg_category_keys=[{"cfg_category_key":"web_download_limit","cfg_version":0}]',
                }
            }
            var res = {
                downloadLimitObj: downloadLimitObj,
                enable: enable
            };
            return res;
        })
        .catch(function() {
            var res = {
                downloadLimitObj: defaultDownloadLimitObj,
                enable: false
            };
            return res;
        });
}

/**
 * 获取调起管家的文件大小阀值
 */
function initSingleFileToGuanjiaLimit(callback) {
    if (!downloadConfig.sizeConfig.isRequestServer) {
        getAbWebLimit()
        .then(function(abWebLimitRes) {
            var downloadLimitObj = abWebLimitRes.downloadLimitObj;
            var enable = abWebLimitRes.enable;
            $.ajax({
                url: downloadLimitObj.url,
                data: downloadLimitObj.data,
                type: 'GET',
                dataType: 'JSON',
                cache: false,
                // async: false,
                timeout: 5000,
                success: function (data) {
                    var limitObj;
                    var tempLimit = downloadConfig.sizeConfig.fileSizeLimit;
                    if (data.errorno === 0 || data.errno === 0) {
                        if (enable) {
                            try {
                                var web_download_limit_obj = {}
                                if (data.web_download_limit && data.web_download_limit.cfg_list && data.web_download_limit.cfg_list[0]) {
                                    web_download_limit_obj = data.web_download_limit.cfg_list[0];
                                }
                                var web_download_limit = web_download_limit_obj.web_download_limit || '{}';
                                var limit = JSON.parse(web_download_limit || '{}').limit || 50;
                                data.content = [
                                    {
                                        "description": "管家调起极限值",
                                        "download_limit": `${limit}`,
                                        "download_limit_chrome": `${limit}`
                                    }
                                ]
                            } catch (error) {
                                console.warn(error);
                            }
                        }
                        if (data.content) {
                            try {
                                limitObj = $.parseJSON(data.content)[0];
                                if (limitObj.download_limit) {
                                    downloadConfig.sizeConfig.fileSizeLimit = parseInt(limitObj.download_limit, 10);
                                }
                                if (limitObj.download_limit_chrome && downloadCommonUtil.isChromeAndGreaterThan42()) {
                                    downloadConfig.sizeConfig.fileSizeLimit = parseInt(limitObj.download_limit_chrome, 10);
                                }
                                downloadConfig.sizeConfig.isDefaultSize = false;
                            } catch (e) {
                                downloadConfig.sizeConfig.fileSizeLimit = tempLimit;
                            }
                        }
                    }
                    downloadConfig.sizeConfig.isRequestServer = true;
                    typeof callback === 'function' && callback();
                },
                error: function () {
                    typeof callback === 'function' && callback();
                }
            });
        })
    } else {
        typeof callback === 'function' && callback();
    }
}

function permutationsTwoStrArr(arr1, arr2) {
    var res = [];
    arr1 = arr1.length > 0 ? arr1 : [''];
    arr2 = arr2.length > 0 ? arr2 : [''];
    for (var i = 0; i < arr1.length; i++) {
        for (var j = 0; j < arr2.length; j++) {
            res.push(arr1[i] + arr2[j]);
        }
    }
    return res;
}

function formatDownloadKeys(arr) {
    var res = [''];
    var keysArr = [];
    for (var i = 0; i < arr.length; i++) {
        keysArr.push(arr[i].split(''));
    }
    for (var j = 0; j < keysArr.length; j++) {
        res = permutationsTwoStrArr(res, keysArr[j]);
    }
    return res;
}

function integrationDownloadKeys(arr) {
    var res = [];
    for (var i = 0; i < arr.length; i++) {
        res = res.concat(formatDownloadKeys(arr[i]));
    }
    res = _.uniq(res);
    return res;
}

directDownloadkeys = directDownloadkeys.length
    ? directDownloadkeys : integrationDownloadKeys(downloadConfig.directDownloadkeysConfig);
// 管家下载映射
guanjiaDownloadkeys = guanjiaDownloadkeys.length
    ? guanjiaDownloadkeys : integrationDownloadKeys(downloadConfig.guanjiaDownloadkeysConig);
// 选择模式下载映射
dialogDownloadkeys = dialogDownloadkeys.length
    ? dialogDownloadkeys : integrationDownloadKeys(downloadConfig.dialogDownloadkeysConfig);


var options = {}; // downloadParam
var EXT_NAME_REG = /\.(\w+)$/;

/**
 * 获取文件类型
 * @param {string} filename
 */
function getExtName(filename) {
    if (typeof filename !== 'string') {
        return '';
    }
    var info = EXT_NAME_REG.exec(filename);
    if (info && info[1]) {
        return info[1];
    }
    return '';
}

/**
 * 下载的文件中是否含有文件夹
 * @param {Array} fileList
 */
function hasDir(fileList) {
    for (var i = 0; i < fileList.length; i++) {
        if (fileList[i].isdir && fileList[i].isdir === 1) {
            return true;
        }
    }
    return false;
}

/**
 * 计算下载文件的大小
 * @param {Array} fileList
 */
function calculateFileSize(fileList) {
    // 单文件
    if (fileList.length === 1) {
        //##empty
    }
}

/**
 * 处理下载模式
 * 映射组合顺序，平台类型 + 产品类型 + 文件个数 + 是否有DLINK(单文件) + 是否文件夹 + 文件大小 + 文件是否chrome下apk exe
 * @param {Object} options
 */
function calculateDownloadKey(options) {
    var fileList = options.list;
    var platform = '';
    var product = '';
    var hasDlink = '';
    var fileNum = '';
    var isdir = '';
    var fileSize = '';
    var fileType = '';
    var totalSize = 0;
    var fileObj;

    // 设置平台 暂时未考虑其他平台
    platform = downloadCommonUtil.isPlatformWindows() ? downloadConfig.PLATFORM_WINDOWS : downloadConfig.PLATFORM_MAC;

    if (downloadCommonUtil.checkIsShare()) {
        product = downloadConfig.PRODUCT_UNIONDIR;
    } else if (getContext().pageInfo.currentProduct === 'share') {
        product = downloadConfig.PRODUCT_SHARE;
    } else {
        product = downloadConfig.PRODUCT_PAN;
    }

    // 设置文件个数
    if (fileList.length === 1) {
        fileNum = downloadConfig.FILE_NUM_SINGLE;
    } else if (fileList.length > 1 && fileList.length < 100) {
        fileNum = downloadConfig.FILE_NUM_MULTIPLE;
    } else {
        fileNum = downloadConfig.FILE_NUM_MORE_100;
    }
    // 设置是否有DLINK
    hasDlink = options.hasDlink ? downloadConfig.FILE_HASDLINK : downloadConfig.FILE_NODLINK;

    // 设置是否文件夹
    isdir = hasDir(fileList) ? downloadConfig.FILE_HASDIR : downloadConfig.FILE_NOTDIR;

    // 设置文件大小
    for (var i = 0; i < fileList.length; i++) {
        totalSize += fileList[i].size;
    }
    totalSize = Math.ceil(totalSize / 1024 / 1024);
    if (totalSize < downloadConfig.sizeConfig.fileSizeSmall) {
        fileSize = downloadConfig.FILE_SIZE_LESS_SMALL;
    } else if (totalSize >= downloadConfig.sizeConfig.fileSizeSmall
        && totalSize <= downloadConfig.sizeConfig.fileSizeLimit) {
        fileSize = downloadConfig.File_SIZE_BETWEEN_SMALL_AND_LIMIT;
    } else {
        fileSize = downloadConfig.FILE_SIZE_MORE_LIMIT;
    }

    // 设置是否chrome下的apk exe(单文件)
    if (fileNum === downloadConfig.FILE_NUM_SINGLE && isdir === downloadConfig.FILE_NOTDIR) {
        fileObj = fileList[0];
        if (downloadCommonUtil.isChrome() && ['exe', 'apk'].indexOf(getExtName(fileObj.server_filename)) > -1) {
            fileType = downloadConfig.FILE_TYPE_CHROMEAPKEXE;
        } else {
            fileType = downloadConfig.FILE_TYPE_GENERAL;
        }
    } else {
        fileType = downloadConfig.FILE_TYPE_GENERAL; // 多文件下不判断文件类型，随便给个值
    }

    // 组装下载key
    downloadkey = platform + product + fileNum + hasDlink + isdir + fileSize + fileType;
    // 映射组合顺序，平台类型 + 产品类型 + 文件个数 + 是否有DLINK(单文件) + 是否文件夹 + 文件大小 + 文件是否chrome下apk exe
    return downloadkey;
}

module.exports = {
    download: function (opts) {
        options = opts;
        var list = options.list;
        var len = list.length;
        var listNotDirLen = _.filter(list, function (item) {
            return +item.isdir !== 1;
        }).length;
        var hasShare = _.some(list, function (item) {
            return item.share;
        });
        var downloadKey = '';
        if (!list.length) {
            getContext().ui.tip({
                mode: 'caution',
                msg: '您还没有选择下载的文件'
            });
            return;
        }

        options.packName = getContext().tools.baseService.parseDirFromPath(list[0].path);

        // 没有选择下载文件统计
        if (len === 0) {
            downloadCommonUtil.useToast({
                toastMode: 'caution',
                msg: '您还没有选择下载的文件'
            });
            return;
        }

        // 文件下载量统计
        if (listNotDirLen > 0) {
            getContext().log.send({
                name: 'file_down_count',
                value: listNotDirLen,
                discription: '文件下载(不包含文件夹)',
                from: hasShare ? 'share' : ''
            });
        }

        // log message
        var prefix = getContext().pageInfo.currentProduct === 'share' ? 'share-' : '';
        options.logMsg = {
            'category': prefix + 'singleFileDownloadCategory',
            'singleFileCategory': prefix + 'singleFileDownloadCategory',
            'multipleFileCategory': prefix + 'multipleFileDownloadCategory',
            'actionRecommendPlugin': 'actionRecommendPluginDialog',
            'actionCompulsoryPlugin': 'actionCompulsoryPluginDialog',
            'actionDownloadByPlugin': 'actionDownloadByPluginAction',
            'actionDownloadClient': 'downloadClientAction',
            'actionInstallClient': 'installClientAction',
            'actionAccelerateDownload': 'accelerateDownloadAction',
            'actionOrdinaryDownload': 'ordinaryDownloadAction',
            'actionDownReportIssue': 'downReportIssueAction',
            'opt_value': 10
        };


        initSingleFileToGuanjiaLimit(function () {
            downloadKey = calculateDownloadKey(options);

            if (downloadKey[0] === downloadConfig.PLATFORM_WINDOWS) {
                getContext().log.send({
                    type: 'download_platform_windows'
                });
            } else {
                if (downloadKey[0] !== downloadConfig.PLATFORM_MAC) {
                    getContext().log.send({
                        type: 'mock_pf_' + navigator.platform
                    });
                    getContext().log.send({
                        type: 'download_platform_others'
                    });
                }
                getContext().log.send({
                    type: 'download_platform_mac'
                });
            }

            // 是否需要单文件视频调起对话框
            if (downloadKey[downloadConfig.INDEX_OF_PRODUCT] !== downloadConfig.PRODUCT_SHARE && options.product_second !== 'mpage') {
                options.isVideo = options.packName && options.list.length === 1 ? +options.list[0].category === 1 : false;
            }

            // 单文件非文件夹
            options.isNormalSingleFile = downloadKey[downloadConfig.INDEX_OF_ISDIR] === downloadConfig.FILE_NOTDIR
                && downloadKey[downloadConfig.INDEX_OF_FILENUM] === downloadConfig.FILE_NUM_SINGLE;
            if (options.list.length === 1 && +options.list[0].category === 1) {
                getContext().log.send({
                    type: 'download_video_widget',
                    from: hasShare ? 'share' : ''
                });
            }
            // 多条下载数据，含有视频文件
            if (options.list.length > 1 && downloadCommonUtil.judgeVideo(options.list, true)) {
                getContext().log.send({
                    type: 'more_download_video_widget',
                    from: hasShare ? 'share' : '',
                    allVideo: !downloadCommonUtil.judgeVideo(options.list, false)
                });
            }
            if (directDownloadkeys.indexOf(downloadkey) > -1) {
                if (getContext().pageInfo.currentProduct === 'share' && !getContext().locals.get('loginstate')) {

                    // 调起登录框
                    window.yunHeader.login.util.loginNew();
                    window.yunHeader.on('loginSuccess', function () {
                        storage.setItem('shareAutoDownload', '1');
                    });
                    return false;
                }

                downloadDirect.start(downloadKey, options);
            } else if (guanjiaDownloadkeys.indexOf(downloadKey) > -1 && !options.isVideo) {
                // 在这里初始化对话框绑定事件，避免guanjiaController和dialogDownload循环引用
                options.mode = 'preInstall';
                downloadDialog.initDialogEvent(downloadKey, options);
                downloadGuanjiaController.start(downloadKey, options);
            } else if (dialogDownloadkeys.indexOf(downloadKey) > -1 || options.isVideo) {
                downloadDialog.start(downloadkey, options);
            } else {
                throw new Error('unknow download key');
            }
        });
    }
};
 
});
;define("function-widget-1:download/logs/agentLog.js",function(e,o,n){function a(e,o){if(o||(o={}),e){var n=t[e];n.ext=o,i.sendLog(n)}}var t={commonBase:{serverId:19071,from:"video",page:"agent_connection",parasitifer:"web",appname:"wangpan"},codePageShow:{type:"display",value:"code",comment:"web外链输入提取码页展现"},codeSuccessPageShow:{type:"display",value:"detail",comment:"web外链提取码成功展现"},sharepageClickDownload:{type:"click",value:"topc",comment:"外链点击下载"}},c=window.BpData;c||(c=function(){},c.prototype.sendLog=function(){});var i=new c(t.commonBase);n.exports.sendlog=function(e,o){setTimeout(function(){a(e,o)},0)}});
;define('function-widget-1:download/start.js', function(require, exports, module){ /**
 * @file start.js
 * @description 下载插件入口函数
 * @see 下载逻辑文档：http://fe.baidu.com/cloud/doc/product/personal_cloud/wangpan/download_test.text
 */

var _ = require('base:widget/libs/underscore.js');
var contextUtil = require('function-widget-1:download/util/context.js');
var agentUbcLog = require('function-widget-1:download/logs/agentLog.js');
var BpABTest = require('function-widget-1:widget/system/utils/ab.js');

var sidList = [];
BpABTest.getSidListArr().then(function (res) {
    sidList = res;
});

function getDlink(fsids, callback, type, linkType) {
    var dlinkService = require('function-widget-1:download/service/dlinkService.js');
    switch (type) {
        case 'mbox':
            break;
        case 'share':
            dlinkService.getDlinkShare(fsids, callback);
            break;
        case 'normal':
        default:
            dlinkService.getDlinkPan(fsids, linkType || 'nolimit', function (data) {
                // 这里不用判断data  因为getDlinkPan里的callback已经做了兼容
                typeof callback === 'function' && callback(data);
            }, undefined, undefined, 'POST');
    }
}

function start(ctx, param) {
    var filesList = null;
    var hasDlink;
    contextUtil.setContext(ctx);

    if (typeof param === 'object' && param.filesList) {
        if (param.filesList.length > 0) {
            filesList = param.filesList;
        } else {
            filesList = [param.filesList];
        }

        hasDlink = !!param.hasDlink;
        // 仅仅获取dlink
        if (param.getDlink && param.callback) {
            var fsids = _.pluck(filesList, 'fs_id');
            getDlink(fsids, param.callback, param.filePosition);
            return;
        }
    } else if (typeof param === 'string') {
        filesList = [{ dlink: param }];
        hasDlink = true;
    } else if (typeof param === 'object' && param.fsids && param.getDlink) {
        getDlink(param.fsids, param.callback, param.filePosition);
        return;
    } else {
        filesList = ctx.list.getSelected();
        if (!filesList || filesList.length === 0) {
            ctx.getList().listHeader.onCheckChanged(true);
            filesList = ctx.list.getSelected();
        }
    }

    var downloadController = require('function-widget-1:download/controller/downloadController.js');
    // 外链页
    if (ctx.pageInfo.currentProduct === 'share' && param && param.from !== 'unzipdownload') {
        var isFcb = filesList && !!filesList.length && filesList.every(item => {
            let index = item.path.toLowerCase().indexOf('.fcb');
            return index !== -1 && index === item.path.toLowerCase().length - 4;
        })
        if (isFcb) {
            contextUtil.getContext().ui.tip({
                mode: 'caution',
                msg: 'fcb文件不支持下载'
            });
            return;
        }
        var fileTypeList = _.map(filesList || [], function (file) {
            try {
                var match = file && file.server_filename && file.server_filename.match(/\.([\w\d]+)$/);
                return match ? match[1] : '';
            } catch (err) {
                console.error(err);
                return '';
            }
        });
        ctx.locals.get(
        'share_uk', 'shareid', 'sign', 'timestamp', 'isPcShareIdWhiteList', 'loginstate', 'pcShareIdFrom',
        function (uk, shareid, sign, servertime, isPcShareIdWhiteList, loginstate, pcShareIdFrom) {
            // 外链场景 && 选择文件后点击下载
            ctx.log.send({
                type: 'web_sharelist_shareid_clk_download_sharelist_entry',
                value: 'web外链下载-点击下载',
                from: shareid,
                isLogin: loginstate,
                isPcShareLink: isPcShareIdWhiteList,
                pcShareIdFrom: pcShareIdFrom,
                fileTypeList: JSON.stringify(fileTypeList),
                sidList: JSON.stringify(sidList)
            });

            // 串联agent数据,增加ubc打点
            try {
                var agentInfo = localStorage.getItem('BD_PAN_AGENT_INFO') || '';
                var [t, agentid, agentchannel] = agentInfo.split("_");
                var isSffective = t && new Date().getTime() - t < 86400000 ? true : false;
        
                if (isSffective) {
                    agentUbcLog.sendlog("sharepageClickDownload", {
                        agentid,
                        agentchannel
                    });
                }
            } catch(err) {
                console.log('agent数据串联error', err);
            }

            downloadController.download({
                list: filesList,
                product: param && param.from === 'unzip' ? 'pan' : ctx.pageInfo.currentProduct,
                hasDlink: hasDlink,
                share_uk: uk,
                share_id: shareid,
                sign: sign,
                timestamp: servertime
            });
        });
    } else {
        downloadController.download({
            list: filesList,
            hasDlink: hasDlink
        });
    }
    var hasWp = _.some(filesList, function (item) {
        return item.isWp;
    });
    if (hasWp && filesList.length > 1) {
        ctx.log.send({
            type: 'web_list_has_wp_download_entry',
            from: ctx.locals.get('docuserchannel')
        });
    }
}

module.exports.start = function (ctx, param) {
    // 如果是外链页，调用下载之前先进行实名认证
    if (ctx.pageInfo.currentProduct === 'share') {
        window.yunHeader.nameVerify(function () {
            start(ctx, param);
        });
    } else {
        start(ctx, param);
    }
};

module.exports.getDownloadLink = function (ctx, params) {
    contextUtil.setContext(ctx);
    getDlink(params.config, params.callback, params.type, params.linkType);
}

const tooltip = document.createElement('div');
tooltip.className = 'custom-tooltip';
document.body.appendChild(tooltip);

const downBtn = document.querySelector('.disk-share-xiazai');

function showTooltip() {
  tooltip.textContent = window.SHAREPAGETYPE==='single_file_page'?(window.metaData.FIRST_FILE_SIZE?(window.metaData.FIRST_FILE_SIZE):''):'';
  updateTooltipPosition();
  tooltip.classList.add('visible');
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

function updateTooltipPosition() {
    const btnRect = downBtn.getBoundingClientRect();
    tooltip.style.top = `${btnRect.bottom + window.scrollY + 8}px`;
    tooltip.style.left = `${btnRect.left + btnRect.width/2 - tooltip.offsetWidth/2}px`;
}

module.exports.showTooltip = function (ctx, param, options) {
    showTooltip();
};

module.exports.hideTooltip =  function () {
    hideTooltip();
};;

 
});
;define("function-widget-1:download/view/downloadDialog.tpl.js",function(a,s,n){var l=[];l.push('<div class="module-download-dilaog">'),l.push('<div id="topTips" class="g-clearfix g-center download-mgr-banner download-mgr-client-hint"></div><div class="content"><div node-type="message-tip" class="message-tip g-center">加载中&hellip;</div></div><div class="dlg-ft"><div class="g-clearfix g-center"><a node-type="download-speedup" class="btn btn-blue btn-blue-long btn-blue-high" href="javascript:void(0);"><span class="text text-normal">加速下载（推荐）</span></a><a node-type="download-normal" class="btn btn-gray btn-gray-long btn-gray-high" href="javascript:void(0);"><span class="text text-normal">普通下载</span></a><span node-type="guanjia-tip" class="download-mgr-hint download-mgr-hint-l special-mgr-left" style="display: block;"><em></em>多文件<b>不限文件个数</b><br>下载<b>更稳定</b></span><span node-type="normal-tip" class="download-mgr-hint download-mgr-hint-r"><em></em>浏览器单线程下载</span></div></div>'),l.push('<div class="dlg-ft01 b-rlv" id="show-acceleration-pack">'),l.push('    <div class="g-clearfix g-center acceleration-pack">'),l.push('        <span class="dowmload-imgs-style dowmload-imgs-style01"></span>'),l.push('        <span class="dowmload-content-style">使用网络加速包,即可为你最高</span>'),l.push('        <span class="download-upspeed-style">提速300%</span>'),l.push('        <a href="javascript:window.open(\'/buy/center?tag=2&frm=dl#network\')"class="download-change-link-style">立即购买</a>'),l.push("    </div>"),l.push("</div>"),l.push('</div">'),n.exports={downloadDialog:l.join("")}});
define("disk-share:widget/system/util/apis.js",function(n,e,i){function o(n){return new Promise(function(e,i){$.getJSON("/pcloud/user/getinfo",{query_uk:n,third:0},function(n){0===n.errno&&n.user_info?e(n.user_info):i(n.show_msg)}).fail(function(){i("fail")})})}function t(n){var e=window.locals.get("__elink_op_user_info");return e?e:o(n).then(function(n){return window.locals.set("__elink_op_user_info",n),n})}i.exports={getUserInfo:o,getUserInfoCache:t}});
;define("disk-share:widget/system/util/elinkThemeRender.js",function(e,t,n){function o(e,t){if(e){var n=$(".module-share-top-bar .g-button[title=保存到网盘]"),o=$("#shareqr .g-button[title=保存到我的百度网盘]");n.remove(),o.remove()}if(t){var r=$(".module-share-top-bar .g-button[title^=下载]"),i=$("#shareqr .g-button[title^=下载]");r.remove(),i.remove()}}n.exports.getTransferAndDownloadStatus=function(e){window.locals.get("Elink_info","Espace_info",function(t,n){function r(e){return t.forbidlist&&-1!==t.forbidlist.indexOf(e)}if(t&&n&&1===t.isElink){var i=r("transfer"),a=r("download");o(i,a),e&&e({cantTransfer:i,cantDownload:a})}else e&&e({cantTransfer:!1,cantDownload:!1})})}});
;define("disk-share:widget/system/util/eFollow.js",function(o,e,n){function t(){function o(){var o=window.locals.get("share_uk"),n=window.locals.get("uk"),t="https://"+u+"/disk/main#/im/session";e.goIMLink.attr("href",t+"?fromId="+n+"&toId="+o+"&covType=companyCov&from=e-web-share")}var e={followWrap:$(".enterprise-follow"),followBtn:$(".enterprise-follow .follow"),goIMBtn:$(".enterprise-follow .go-im"),goIMLink:$(".enterprise-follow .go-im a"),notOpenIM:$(".enterprise-follow .not-open-im")};e.followWrap.show(),s().then(function(n){return 1!==n.im_open?void e.notOpenIM.show():void(1===n.is_follow?(e.goIMLink.attr("href",""),e.goIMBtn.show(),o()):(e.followBtn.show(),r.log.send({type:"e_fol_link_show",value:"带有关注按钮的外链页展现"})))},function(o){r.log.send({type:"e_fol_request_error",value:o})}),e.followBtn.on("click",c.debounce(function(){r.log.send({type:"e_clk_fol",value:"用户在企业外链页点击关注"}),l(!0).then(function(){e.followBtn.hide(),e.goIMBtn.show(),r.ui.tip({mode:"success",msg:"关注成功",autoClose:!0,className:"enterprise-module-yun-tip"}),o(),r.log.send({type:"e_clk_fol_succ",value:"用户在企业外链页关注成功"})},function(){r.ui.tip({mode:"failure",msg:"关注失败，请稍后再试",autoClose:!0})})},500)),e.goIMBtn.on("click",function(){r.log.send({type:"e_clk_send_msg",value:"企业外链点击发消息"})})}function s(){return new Promise(function(o,e){var n=window.locals.get("share_uk"),t={ciduk:n};$.get("/basembox/follow/getinfo",t,function(n){n&&0===n.errno?o(n):e(n.show_msg)}).fail(function(o){e(o.statusText)})})}function l(o){return new Promise(function(e,n){var t=window.locals.get("share_uk"),s={ciduk:t,method:o?"follow":"unfollow",source:"101"};$.post("/basembox/follow/set",s,function(o){o&&0===o.errno?e(o):n(o.show_msg)}).fail(function(o){n(o.statusText)})})}function i(){var o="/act/api/conf?conf_key=enterprise_im_point";$.ajax({url:o,type:"get",dataType:"json",success:function(o){try{var e=o.data[0].conf_value.conf||{},n=JSON.parse(e),s="1"===n.open;s&&t()}catch(l){console.log(l)}},error:function(){}})}var r=o("system-core:context/context.js").instanceForSystem,c=o("base:widget/libs/underscore.js"),u=window.host&&window.host.HOST_PAN||"pan.baidu.com";n.exports=i});
;define("disk-share:widget/system/util/eCard.js",function(e,t,i){function r(e){for(var t="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",i="",r=e;r>0;--r)i+=t[Math.floor(Math.random()*t.length)];return i}function a(e){for(var t=0,i=0;i<e.length;i++){var r=e.charAt(i);t+="@"===r||/[a-zA-Z]/.test(r)&&r===r.toUpperCase()||null!=r.match(/[^\x00-\xff]/gi)?2:1}return t}function n(e,t,i,r){var a=l(t),n=l(e);if(!a||!n)return void console.log("不存在",a,"或",n);var s=new f(e),o=a.val();s.setText(o),s.on("success",function(){p.ui.tip({mode:"success",msg:"复制成功！"}),p.log.send({type:"enterprise_disk_business_card_item_click",fromPage:r,cardType:i.card_type===h.enterprise?"enterprise":"staff"})}),s.on("error",function(){p.ui.tip({mode:"caution",msg:"复制失败！",hasClose:!0,autoClose:!1})})}function s(e,t,i,s){this.trigger=l(e)[0];var o=document.createElement("div");o.setAttribute("style","position: absolute; top: 0px; left: 0px; width: 100%;");var c=document.createElement("div"),d="tooltip-"+r(6),f=this;c.className="e-tooltip-wrap "+d,c.innerHTML='        <div class="e-tooltip">			  <input class="value" disabled />			  <div class="btn" role="button" id="e-phone-copy">复制</div>            <div class="e-triangle"></div>        </div>',o.appendChild(c),document.body.appendChild(o),this.el=c,l("."+d+" .value").val(t).attr("size",a(t||5)+1),n("."+d,"."+d+" .value",i,s),this.cancelOpt=!1,this.show=function(e){this.el.style.display="block";var t=e.pageX-e.offsetX+e.target.offsetWidth/2-this.el.offsetWidth/2,i=e.pageY-e.offsetY-this.el.offsetHeight;this.el.style.left=t+"px",this.el.style.top=i+"px"},this.hide=function(){setTimeout(function(){return f.cancelOpt?void(f.cancelOpt=!1):void(f.el.style.display="none")},50)},this.trigger.addEventListener("mouseenter",function(e){f.show(e)}),this.trigger.addEventListener("mouseleave",function(e){f.hide(e)}),this.el.addEventListener("mouseenter",function(){f.cancelOpt=!0}),this.el.addEventListener("mouseleave",function(e){f.hide(e)})}function o(e,t,i,r){e.infos.forEach(function(a){e[a]&&(l(".enterprise-card-mini "+t+"-card ."+a).css("display","inline-block"),new s(".enterprise-card-mini "+t+"-card ."+a,e[a],i,r))}),e.avatar&&l(".avatar .photo-frame img").css({"object-fit":"cover",width:"44px",height:"44px"}).attr("src",e.avatar),e.name&&l(".username").text(e.name),e.intro&&l(".author-desc").text(e.intro),l(".enterprise-card-mini").show()}function c(e,t,i,r){e.infos.forEach(function(s){var o=e[s];o&&(l(".enterprise-card "+t+"-card-detail .e-row."+s).show(),itemPrefix=t+"-"+s,l(itemPrefix+"-value").val(o).attr("size",a(o||5)+1),n(itemPrefix+"-copy",itemPrefix+"-value",i,r))}),e.avatar&&l(".share-person-avatar img").css({"object-fit":"cover"}).attr("src",e.avatar),e.name&&l(".share-person-username").text(e.name),e.intro&&l(".author-intro").text(e.intro)}function d(e,t){var i={},r="",a=e.card_type===h.enterprise?"enriskinfo":"riskinfo",n=e[a];if(n){var s=n.split(";");s.forEach(function(t){e[t]=""})}if(e.card_type===h.enterprise)i={phone:e.enphone,email:e.enemail,address:e.enaddress,avatar:e.logo,name:e.enname},i.infos=["phone","email","address"],r=".ent";else{if(e.card_type!==h.staff)return;i={phone:e.phone,wechat:e.vxnum,email:e.email,avatar:e.avatar,name:e.uname,intro:e.title},i.infos=["phone","wechat","email"],r=".staff"}"sharecode"===t?o(i,r,e,t):(c(i,r,e,t),e.card_type===h.enterprise&&l(".enterprise-info .from-info").hide()),p.log.send({type:"enterprise_disk_business_card_show",fromPage:t,cardType:e.card_type===h.enterprise?"enterprise":"staff"})}var l=e("base:widget/libs/jquerypacket.js"),f=e("base:widget/clipboard/myClipboard.js"),p=e("system-core:context/context.js").instanceForSystem,h={enterprise:2,staff:1};i.exports=d});
;define("disk-share:widget/system/util/ticketBind.js",function(i,n,e){var t=function(){var i=window.locals.get("share_uk"),n=window.locals.get("shareid"),e=window.location.pathname.split("/s/")[1];return e?new Promise(function(t,o){$.get("/api/shorturlinfo",{root:1,uk:i,shareid:n,shorturl:e},function(i){i&&0===i.errno?t(1===i.privilege_type?!0:!1):o(i.show_msg)}).fail(function(){o("fail")})}):Promise.resolve(!1)},o=function(){var i=window.locals.get("share_uk"),n=window.locals.get("shareid");return new Promise(function(e,t){var o={tkappid:1e4,activity_uk:i,activity_id:n};$.post("/ticket/api/getbindinfo",o,function(i){if(i&&0===i.errno){var n=i.data,o=1e3*n.activity_expired<=+new Date;n._isValid=n.remain_count>0&&!o,window.locals.set("bind_info",n),e(n)}else t(i.show_msg)}).fail(function(){t("fail")})})},r=function(){var i=window.locals.get("bind_info");return i?Promise.resolve(i):t().then(function(i){return i?o():null},function(i){return console.error(i),null})};e.exports=r});
;define("disk-share:widget/system/util/certFollow.js",function(o,e,n){function t(){function o(){var o=r,n=window.locals.get("uk"),t="https://"+u+"/disk/main#/im/session";e.goIMLink.attr("href",t+"?fromId="+n+"&toId="+o+"&covType=companyCov&from=e-web-share")}var e={followWrap:$(".enterprise-follow"),followBtn:$(".enterprise-follow .follow"),goIMBtn:$(".enterprise-follow .go-im"),goIMLink:$(".enterprise-follow .go-im a"),notOpenIM:$(".enterprise-follow .not-open-im")};e.followWrap.show(),s().then(function(n){return 1!==n.im_open?void e.notOpenIM.show():(r=n.ciduk,void(1===n.is_follow?(e.goIMLink.attr("href",""),e.goIMBtn.show(),o()):(e.followBtn.show(),c.log.send({type:"e_fol_link_show",value:"带有关注按钮的外链页展现"}))))},function(o){c.log.send({type:"e_fol_request_error",value:o})}),e.followBtn.on("click",f.debounce(function(){c.log.send({type:"e_clk_fol",value:"用户在企业外链页点击关注"}),i(!0).then(function(){e.followBtn.hide(),e.goIMBtn.show(),c.ui.tip({mode:"success",msg:"关注成功",autoClose:!0,className:"enterprise-module-yun-tip"}),o(),c.log.send({type:"e_clk_fol_succ",value:"用户在企业外链页关注成功"})},function(){c.ui.tip({mode:"failure",msg:"关注失败，请稍后再试",autoClose:!0})})},500)),e.goIMBtn.on("click",function(){c.log.send({type:"e_clk_send_msg",value:"企业外链点击发消息"})})}function s(){return new Promise(function(o,e){var n=window.locals.get("share_uk"),t={uk:n};$.get("/basembox/follow/getinfo",t,function(n){n&&0===n.errno?o(n):e(n.show_msg)}).fail(function(o){e(o.statusText)})})}function i(o){return new Promise(function(e,n){var t={ciduk:r,method:o?"follow":"unfollow",source:"101"};$.post("/basembox/follow/set",t,function(o){o&&0===o.errno?e(o):n(o.show_msg)}).fail(function(o){n(o.statusText)})})}function l(){var o="/act/api/conf?conf_key=enterprise_im_point";$.ajax({url:o,type:"get",dataType:"json",success:function(o){try{var e=o.data[0].conf_value.conf||{},n=JSON.parse(e),s="1"===n.open;s&&t()}catch(i){console.log(i)}},error:function(){}})}var r,c=o("system-core:context/context.js").instanceForSystem,f=o("base:widget/libs/underscore.js"),u=window.host&&window.host.HOST_PAN||"pan.baidu.com";n.exports=l});
;define("disk-share:widget/system/util/makeup.js",function(e,a,s){var t=e("base:widget/libs/jquerypacket.js"),h={share_back:"https://staticsns.cdn.bcebos.com/amis/2022-10/1667033900398/web_svip_share_code.png",share_head:"#E9C87A",share_hover:"#FDF2E0",share_name:"#64360D",share_text:"#64360D",share_send_button:"#FFFFFF",share_send_text:"#402200",share_page_back:"https://staticsns.cdn.bcebos.com/amis/2022-10/1667033901035/web_svip_share_list.png",share_page_head:"#F8E0B5",share_page_hover:"#F1C77C",share_page_name:"#402200",share_page_send_button:"#FFD58C",share_page_send_text:"#402200",share_page_text:"#8C7861"},r={themeBack:t(".acss-header .theme-share-back"),themeHead:t(".theme-share-head"),themeName:t(".theme-share-name"),themeText:t(".theme-share-text"),themeNameHover:t(".theme-share-name-hover"),themePageBack:t(".theme-share-page-back"),themePageHead:t(".theme-share-page-head"),themePageName:t(".theme-share-page-name"),themePageHover:t(".theme-share-page-name-hover"),shareLimit:t(".limit-share-lock-icon")},n=function(e){r.themeBack.css({background:"url("+e.share_back+") no-repeat"}),r.themeHead.css({background:e.share_head}),r.themeName.css({color:e.share_name}),r.themeText.css({color:e.share_text}),r.themeNameHover.css({background:e.share_send_button,color:e.share_send_text}),r.themeNameHover.hover(function(){t(this).css({background:e.share_hover})},function(){t(this).css({background:e.share_send_button})}),window.locals.get("sharetype",function(a){a+""=="4"&&r.shareLimit.css({background:e.share_send_button,color:e.share_send_text})})},o=function(e){r.themePageBack.css({background:"url("+e.share_page_back+") center/cover no-repeat #fff"}),r.themePageHead.css({borderColor:e.share_page_head}),r.themePageName.css({color:e.share_page_name}),r.themePageHover.css({background:e.share_page_send_button,color:e.share_page_send_text}),r.themePageHover.hover(function(){t(this).css({background:e.share_page_hover})},function(){t(this).css({background:e.share_page_send_button})})};s.exports=function(e,a){var s=1;window.locals.get("share_uk",function(r){t.getJSON("/act/v2/skin/inuse",{uk:r,stype:1001,share_page:s},function(s){var r=h;0===s.errno?(r=t.extend({},h,s.data.web_sharelink||{}),a.log.send({type:"theme-success",value:"加载配置成功",from:s.data.id})):a.log.send({type:"theme-fail-default",value:"加载配置失败显示默认配置"}),"sharecode"===e?n(r):o(r)})})}});
;define("disk-share:widget/system/verifyCodeDialog/newVerify.js",function(e,i,t){var o,n=e("base:widget/libs/jquerypacket.js"),d=e("system-core:context/context.js").instanceForSystem,s=function(){this.token=void 0,this.type=void 0};s.prototype.build=function(){var e=['<div class="download-verify" style="margin-top: 20px;margin-bottom: 20px;padding: 0 28px;text-align: left;font-size: 12px;" id="downloadVerify">',"</div>"],i={title:"添加好友",className:"add-friend",body:e.join(""),draggable:!1,width:"480px",position:{xy:"center"}};"undefined"==typeof o&&(o=d.ui.window(i)),n("#downloadVerify").parents(".dialog").css("width","376px"),o.show()},s.prototype.show=function(i){this.build(),e.async("disk-share:widget/system/verifyCodeDialog/verifyUser.min.js",function(e){new e.VcodeForPC({container:document.getElementById("downloadVerify"),ak:8241,cb:function(e,t){i.onSubmitFunc&&i.onSubmitFunc(e,t),o.hide()}})})},t.exports=new s});
;define("disk-share:widget/system/util/monitor/monitor.js",function(e,r,s){var t=e("system-core:context/context.js").instanceForSystem;s.exports=function(e){e=e||{};var r=e.scene,s=e.status,o=e.errno,n=e.from||"",a=e.source||"";if(r||s){var c={shareFile:"web_create_share",extract:"web_sharelink_extract",transfer:"web_sharelink_transfer",download:"web_sharelink_download"},i={success:"_success",fail:"_fail",error:"_error"};c[r]&&i[s]&&t.log.send({type:c[r]+i[s],errno:o,from:n,source:a})}}});
;define("disk-share:widget/system/util/enterpriseThemeRender.js",function(e,r,t){function s(e,r){var t={enterprise:2,staff:1};return e?e.card_type===t.enterprise?"来自企业的分享":"来自企业员工的分享":r?"来自企业的分享":"来自企业员工的分享"}var i=e("base:widget/libs/jquerypacket.js"),a=e("system-core:context/context.js").instanceForSystem,n=e("disk-share:widget/system/util/ticketBind.js"),o=e("disk-share:widget/system/util/eCard.js"),m=e("disk-share:widget/system/util/eFollow.js"),d=e("disk-share:widget/system/util/elinkThemeRender.js"),h=e("disk-share:widget/system/util/apis.js"),c={shareCodeConfig:{fromCertShareText:"来自企业的分享",avatarBg:"#ffffff",themeName:"#ffffff",themeText:"#ffffff",themeDesc:"#ffffff",themeFromCertShare:"10px",themeBtn:{bg:"#0065dd",color:"#ffffff",border:"1px solid #ffffff"},shareCodeBgImg:{img:"https://staticwx.cdn.bcebos.com/mini-program%2Fimages%2Fcertification-user-bg-web.png",normalImg:"https://staticwx.cdn.bcebos.com/mini-program/images/enterprise/web%E5%A4%96%E9%93%BE%E9%A1%B5%E8%83%8C%E6%99%AF.png",size:"100% 100%"},submitBtn:{bg:"#0065dd",color:"#ffffff"},certTip:{top:"225px"},limit:{limitNum:"150px"},tip:{top:"225px"}}},p=function(e,r){var t={tip:i(".tip"),abbrName:i(".verify-user .username"),enterprise:i(".verify-user .enterprise"),vipIcon:i(".verify-user-avatar"),avatarIcon:i(".photo-frame .cert-info"),themeAvatar:i(".theme-share-head"),themeName:i(".theme-share-name"),enterpriseThemeName:i(".enterprise.theme-share-name"),themeFromCertShare:i(".from-cert-share"),themeText:i(".theme-share-text"),themeDesc:i(".author-desc"),themeFriendBtn:i(".verify-btn .verify-friend"),themeSendBtn:i(".verify-btn .verify-send"),avatar:i(".avatar"),submitBtn:i(".submit-a"),certTip:i(".cert-tip"),memo:i(".verify-memo"),memoText:i(".verify-memo-text"),limitShareNum:i(".limit-share-limit-num"),enterpriseRight:i(".enterprise-right"),enterpriseRightIcon:i(".enterprise-right .right-icon"),limitShareLockIcon:i(".limit-share-lock-icon"),verifyBtn:i(".verify-btn")},s=c.shareCodeConfig;t.abbrName.text(e.name),t.themeDesc.text(e.brief),0===e.certStatus&&t.avatarIcon.addClass("cert-icon"),e.isEnterpriseOwner!==!0&&(t.enterprise.text("-"+e.space_name),t.enterprise.css({display:"inline-block",_display:"inline"})),4!==+r&&t.themeFromCertShare.text(s.fromCertShareText),e.memo&&(t.memoText.text("链接备注："+e.memo),t.memo.show(),t.certTip.css({top:s.certTip.top}),t.tip.css({top:s.tip.top}),t.limitShareNum.css({top:s.limit.limitNum})),t.certTip.show(),t.themeAvatar.css({background:s.avatarBg}),t.themeName.css({color:s.themeName}),t.themeText.css({color:s.themeText}),t.themeDesc.css({color:s.themeDesc}),t.themeFromCertShare.css({"font-size":s.themeFromCertShare}),t.themeFriendBtn.css({background:s.themeBtn.bg,color:s.themeBtn.color,border:s.themeBtn.border}),t.themeSendBtn.css({background:s.themeBtn.bg,color:s.themeBtn.color,border:s.themeBtn.border});var a=e.isCertValid?s.shareCodeBgImg.img:s.shareCodeBgImg.normalImg;t.avatar.parent().css({"background-image":"url("+a+")","background-size":s.shareCodeBgImg.size}),t.submitBtn.css({background:s.submitBtn.bg,border:"1px solid "+s.submitBtn.bg}),t.vipIcon.hide(),t.limitShareLockIcon.hide(),t.verifyBtn.hide(),e.isCertValid||t.enterpriseThemeName.hide()},f=function(e){var r={shareContent:i("#bd-main"),shareList:i("#bd-main .bd-left"),sideContent:i(".bd-aside"),sideTopBg:i(".cert-top-banner"),sideBack:i(".theme-share-page-back"),sidePersonInfo:i(".module-share-person-info"),certIcon:i(".share-person-avatar .cert-info"),sharePersonInfoName:i(".share-person-data .share-person-username"),sharePersonInfoIntro:i(".author-desc .author-intro"),sharePersonCertinfo:i(".share-person-certinfo"),themeInfoContnet:i(".module-share-person-info .share-person-inner"),themeAvatar:i(".theme-share-page-head"),themeName:i(".theme-share-page-name"),themeIntro:i(".author-intro"),themePageHover:i(".theme-share-page-name-hover"),themeSubscribe:i(".verb-button"),frameContent:i(".frame-content"),frameMain:i(".frame-main"),certUserShareList:i(".cert-user-share-list"),enterpriseInfo:i(".enterprise-info"),enterpriseInfoFrom:i(".enterprise-info .from-info"),enterprisememo:i(".enterprise-memo"),enterprisememoInfo:i(".enterprise-memo .memo-info"),shareLimit:i(".icon-share-lock"),vipIcon:i(".share-person-data-top .sicon"),lhbButton:i(".btn-img-tips"),verifyFriend:i(".verify-friend"),verifySend:i(".verify-send")};r.frameContent.css({"margin-right":"244px"}),r.frameMain.css({border:"none"}),r.shareContent.css({border:"none"}),r.shareList.css({margin:"0px 250px 0 0",border:"1px solid #e2e2e2"}),r.sideContent.css({width:"230px"}),r.sideTopBg.css({height:"24px",position:"absolute",top:"0px",width:"100%"}),r.sideTopBg.addClass("person-info-top-bg"),r.sideBack.css({background:"#f7f7f7",top:"0px",width:"230px"}),r.sidePersonInfo.css({background:"#fff",height:"100%","box-sizing":"border-box",padding:"10px 16px"}),e.isCertValid&&r.certIcon.addClass("cert-icon"),r.sharePersonInfoName.text(e.name),r.sharePersonInfoIntro.text(e.brief),r.sharePersonCertinfo.show(),r.themeInfoContnet.css({padding:"38px 0 10px 0"}),r.themeAvatar.css({"border-color":"#0065dd"}),r.themeName.css({color:"#333333","font-weight":"bold","max-width":"149px"}),r.themeIntro.css({color:"#666666"}),r.themePageHover.css({background:"#0065dd",color:"#fff"}),r.sidePersonInfo.addClass("is-cert"),e.isCertValid&&r.enterpriseInfoFrom.text("来自："+e.space_name),r.enterpriseInfo.show(),r.shareLimit.hide(),r.lhbButton.hide(),r.verifyFriend.hide(),r.verifySend.hide(),r.vipIcon.hide()},l={1:{name:"基础券",saveNum:"3000"},2:{name:"豪华券",saveNum:"5万"}},u=function(e){i(".cert-user-share-list").text(e).show()},g=function(e){return 1!==window.locals.get("loginstate")&&e.isCertValid?void u(e.shareListBrand):void n().then(function(r){if(r){var t="分享者为您提供了极速下载 单次保存"+l[r.package_type].saveNum+"个文件";i(".cert-user-share-bind-info-head").text(t),i(".cert-user-share-bind-info").addClass(r._isValid?"":"is-disabled").show(),a.log.send(r._isValid?{type:"web_share_list_page_speed_coupon_display",value:"外链页展示绑定企业券权益"}:{type:"web_share_list_page_speed_coupon_not_valid_display",value:"外链页展示绑定企业券权益，已失效"})}else e.isCertValid&&u(e.shareListBrand)},function(e){console.error(e)})};t.exports=function(e,r,t){window.locals.get("Elink_info","Espace_info","card_info",function(a,n,c){if(a&&n){var l={};l.isEnterpriseLink=1===a.isElink,l.memo=a.Elink_memo,l.isEnterpriseOwner=1===n.Espace_op_role,l.certStatus=n.Espace_cert_status||0,l.isCertValid=0===n.Espace_cert_status,l.name=l.isEnterpriseOwner?n.Espace_name:n.Espace_op_name,l.brief=l.isCertValid?n.Espace_brief:"",l.space_name=n.Espace_name,l.opStatus=n.Espace_op_status||0,l.productType=n.Espace_product_type,l.productStatus=n.Espace_product_status,l.shareListBrand=s(c,l.isEnterpriseOwner),i("#bd").addClass("is-enterprise"),l.isCertValid&&i("#bd").addClass("is-cert-valid");var u=a.forbidlist&&-1!==a.forbidlist.indexOf("transfer"),b=a.forbidlist&&-1!==a.forbidlist.indexOf("download");l.isEnterpriseLink&&"sharelist"===e&&(u||b)&&(l.shareListBrand+="（文件仅支持查看）"),l.isEnterpriseLink&&("sharecode"===e?window.locals.get("sharetype",function(e){p(l,e)}):"sharelist"===e&&(g(l),f(l)),l.isCertValid||h.getUserInfoCache(a.Elink_opuk).then(function(r){var t=i("sharecode"===e?".username":".share-person-username"),s=i("sharecode"===e?".avatar .photo-frame img":".share-person-avatar img");t.text(r.uname),s.attr("src",r.avatar_url)})),"sharelist"===e&&d.getTransferAndDownloadStatus(),l.isCertValid&&c&&o(c,e),m(),r(l)}else t()})}});
;define("disk-share:widget/system/util/certThemeRender.js",function(e,t,r){var s=e("base:widget/libs/jquerypacket.js"),o=e("system-core:context/context.js").instanceForSystem,a=e("disk-share:widget/system/util/ticketBind.js"),n=(window.yunData,e("disk-share:widget/system/util/certFollow.js")),i={shareCodeConfig:{fromCertShareText:"来自企业的分享",avatarBorder:"#C3E9FE",themeName:"#ffffff",themeText:"#ffffff",themeDesc:"#ffffff85",themeFromCertShare:"10px",themeBtn:{bg:"#0065dd",color:"#ffffff",border:"1px solid #ffffff"},shareCodeBgImg:{img:"https://staticwx.cdn.bcebos.com/mini-program%2Fimages%2Fcertification-user-bg-web.png",size:"100% 100%"},submitBtn:{bg:"#0065dd",color:"#ffffff"}}},h=function(e,t){var r={abbrName:s(".verify-user .username"),avatarIcon:s(".photo-frame .cert-info"),vipIcon:s(".verify-user-avatar"),themeAvatarBorder:s(".theme-share-head"),themeName:s(".theme-share-name"),themeFromCertShare:s(".from-cert-share"),themeText:s(".theme-share-text"),themeDesc:s(".author-desc"),themeFriendBtn:s(".verify-btn .verify-friend"),themeSendBtn:s(".verify-btn .verify-send"),avatar:s(".avatar"),submitBtn:s(".submit-a"),certTip:s(".cert-tip")},o=i.shareCodeConfig;r.abbrName.text(e.abbr_name),r.themeDesc.text(e.cert_info),r.avatarIcon.addClass("cert-icon"),4!==+t&&r.themeFromCertShare.text(o.fromCertShareText),r.themeAvatarBorder.css({background:o.avatarBorder}),r.themeName.css({color:o.themeName}),r.themeText.css({color:o.themeText}),r.themeDesc.css({color:o.themeDesc}),r.themeFromCertShare.css({"font-size":o.themeFromCertShare}),r.themeFriendBtn.css({background:o.themeBtn.bg,color:o.themeBtn.color,border:o.themeBtn.border}),r.themeSendBtn.css({background:o.themeBtn.bg,color:o.themeBtn.color,border:o.themeBtn.border}),r.avatar.parent().css({"background-image":"url("+o.shareCodeBgImg.img+")","background-size":o.shareCodeBgImg.size}),r.submitBtn.css({background:o.submitBtn.bg,border:"1px solid "+o.submitBtn.bg}),r.certTip.show(),r.vipIcon.hide()},c=function(e){var t={shareContent:s("#bd-main"),shareList:s("#bd-main .bd-left"),sideContent:s(".bd-aside"),sideTopBg:s(".cert-top-banner"),sideBack:s(".theme-share-page-back"),sidePersonInfo:s(".module-share-person-info"),certIcon:s(".share-person-avatar .cert-info"),sharePersonInfoName:s(".share-person-data .share-person-username"),sharePersonInfoIntro:s(".author-desc .author-intro"),sharePersonCerinfo:s(".share-person-certinfo"),themeInfoContnet:s(".module-share-person-info .share-person-inner"),themeAvatar:s(".theme-share-page-head"),themeName:s(".theme-share-page-name"),themeIntro:s(".author-intro"),themePageHover:s(".theme-share-page-name-hover"),themeSubscribe:s(".verb-button"),frameContent:s(".frame-content"),frameMain:s(".frame-main"),vipIcon:s(".share-person-data-top .sicon"),certUserShareList:s(".cert-user-share-list")};"new_single_disk_share"!==window.SHARETYPE&&t.frameContent.css({"margin-right":"244px"}),t.frameMain.css({border:"none"}),t.shareContent.css({border:"none"}),t.shareList.css({margin:"0px 250px 0 0",border:"1px solid #e2e2e2"}),t.sideContent.css({width:"230px"}),t.sideTopBg.css({height:"24px",position:"absolute",top:"0px",width:"100%"}),t.sideTopBg.addClass("person-info-top-bg"),t.sideBack.css({background:"#f7f7f7",top:"0px",width:"230px"}),t.sidePersonInfo.css({background:"#fff",height:"100%","box-sizing":"border-box"}),t.certIcon.addClass("cert-icon"),t.sharePersonInfoName.text(e.abbr_name),t.sharePersonInfoIntro.text(e.cert_info),e.isOwner===!1&&t.sharePersonCerinfo.show(),t.themeInfoContnet.css({padding:"38px 0 10px 0"}),t.themeAvatar.css({"border-color":"#0065dd"}),t.themeName.css({color:"#333333","font-weight":"bold"}),t.themeIntro.css({color:"#666666"}),t.themePageHover.css({background:"#0065dd",color:"#fff"}),t.sidePersonInfo.addClass("is-cert"),t.vipIcon.hide()},d={1:{name:"基础券",saveNum:"3000"},2:{name:"豪华券",saveNum:"5万"}},m=function(){var e=i.shareCodeConfig.fromCertShareText;s(".cert-user-share-list").text(e).show()},f=function(){return 1!==window.locals.get("loginstate")?void m():void a().then(function(e){if(e){var t="分享者为您提供了极速下载 单次保存"+d[e.package_type].saveNum+"个文件";s(".cert-user-share-bind-info-head").text(t),s(".cert-user-share-bind-info").addClass(e._isValid?"":"is-disabled").show(),o.log.send(e._isValid?{type:"web_share_show_coup_bind",value:"外链页展示绑定企业券权益"}:{type:"web_share_show_coup_bind_not_valid",value:"外链页展示绑定企业券权益，已失效"})}else m()},function(e){console.error(e)})};r.exports=function(e,t,r){var o="/api/certuser/get?msg_flag=1&by_op=0&uk="+window.locals.get("share_uk");s.get(o,function(r){var s=r.data||{},o=2===s.cert_status&&0===s.cancel_status,a=2===s.cert_try_status;s.isCertUser=o||a,s.isOwner=!!window.locals.get("self"),s.useCertTheme=!1,window.locals.get("Elink_info",function(t){t&&(0===t.isElink&&t.eflag_disable===!1&&(s.useCertTheme=!0),s.isCertUser&&s.useCertTheme&&("sharecode"===e?window.locals.get("sharetype",function(e){h(s,e)}):"sharelist"===e&&(f(),c(s),n())))}),t(s)},"json").fail(r)}});
;define("disk-share:widget/system/util/getAdList/MD5.js",function(n,r,t){function e(n,r){n[r>>5]|=128<<r%32,n[(r+64>>>9<<4)+14]=r;for(var t=1732584193,e=-271733879,u=-1732584194,h=271733878,s=0;s<n.length;s+=16){var A=t,d=e,g=u,v=h;t=f(t,e,u,h,n[s+0],7,-680876936),h=f(h,t,e,u,n[s+1],12,-389564586),u=f(u,h,t,e,n[s+2],17,606105819),e=f(e,u,h,t,n[s+3],22,-1044525330),t=f(t,e,u,h,n[s+4],7,-176418897),h=f(h,t,e,u,n[s+5],12,1200080426),u=f(u,h,t,e,n[s+6],17,-1473231341),e=f(e,u,h,t,n[s+7],22,-45705983),t=f(t,e,u,h,n[s+8],7,1770035416),h=f(h,t,e,u,n[s+9],12,-1958414417),u=f(u,h,t,e,n[s+10],17,-42063),e=f(e,u,h,t,n[s+11],22,-1990404162),t=f(t,e,u,h,n[s+12],7,1804603682),h=f(h,t,e,u,n[s+13],12,-40341101),u=f(u,h,t,e,n[s+14],17,-1502002290),e=f(e,u,h,t,n[s+15],22,1236535329),t=i(t,e,u,h,n[s+1],5,-165796510),h=i(h,t,e,u,n[s+6],9,-1069501632),u=i(u,h,t,e,n[s+11],14,643717713),e=i(e,u,h,t,n[s+0],20,-373897302),t=i(t,e,u,h,n[s+5],5,-701558691),h=i(h,t,e,u,n[s+10],9,38016083),u=i(u,h,t,e,n[s+15],14,-660478335),e=i(e,u,h,t,n[s+4],20,-405537848),t=i(t,e,u,h,n[s+9],5,568446438),h=i(h,t,e,u,n[s+14],9,-1019803690),u=i(u,h,t,e,n[s+3],14,-187363961),e=i(e,u,h,t,n[s+8],20,1163531501),t=i(t,e,u,h,n[s+13],5,-1444681467),h=i(h,t,e,u,n[s+2],9,-51403784),u=i(u,h,t,e,n[s+7],14,1735328473),e=i(e,u,h,t,n[s+12],20,-1926607734),t=o(t,e,u,h,n[s+5],4,-378558),h=o(h,t,e,u,n[s+8],11,-2022574463),u=o(u,h,t,e,n[s+11],16,1839030562),e=o(e,u,h,t,n[s+14],23,-35309556),t=o(t,e,u,h,n[s+1],4,-1530992060),h=o(h,t,e,u,n[s+4],11,1272893353),u=o(u,h,t,e,n[s+7],16,-155497632),e=o(e,u,h,t,n[s+10],23,-1094730640),t=o(t,e,u,h,n[s+13],4,681279174),h=o(h,t,e,u,n[s+0],11,-358537222),u=o(u,h,t,e,n[s+3],16,-722521979),e=o(e,u,h,t,n[s+6],23,76029189),t=o(t,e,u,h,n[s+9],4,-640364487),h=o(h,t,e,u,n[s+12],11,-421815835),u=o(u,h,t,e,n[s+15],16,530742520),e=o(e,u,h,t,n[s+2],23,-995338651),t=c(t,e,u,h,n[s+0],6,-198630844),h=c(h,t,e,u,n[s+7],10,1126891415),u=c(u,h,t,e,n[s+14],15,-1416354905),e=c(e,u,h,t,n[s+5],21,-57434055),t=c(t,e,u,h,n[s+12],6,1700485571),h=c(h,t,e,u,n[s+3],10,-1894986606),u=c(u,h,t,e,n[s+10],15,-1051523),e=c(e,u,h,t,n[s+1],21,-2054922799),t=c(t,e,u,h,n[s+8],6,1873313359),h=c(h,t,e,u,n[s+15],10,-30611744),u=c(u,h,t,e,n[s+6],15,-1560198380),e=c(e,u,h,t,n[s+13],21,1309151649),t=c(t,e,u,h,n[s+4],6,-145523070),h=c(h,t,e,u,n[s+11],10,-1120210379),u=c(u,h,t,e,n[s+2],15,718787259),e=c(e,u,h,t,n[s+9],21,-343485551),t=a(t,A),e=a(e,d),u=a(u,g),h=a(h,v)}return Array(t,e,u,h)}function u(n,r,t,e,u,f){return a(h(a(a(r,n),a(e,f)),u),t)}function f(n,r,t,e,f,i,o){return u(r&t|~r&e,n,r,f,i,o)}function i(n,r,t,e,f,i,o){return u(r&e|t&~e,n,r,f,i,o)}function o(n,r,t,e,f,i,o){return u(r^t^e,n,r,f,i,o)}function c(n,r,t,e,f,i,o){return u(t^(r|~e),n,r,f,i,o)}function a(n,r){var t=(65535&n)+(65535&r),e=(n>>16)+(r>>16)+(t>>16);return e<<16|65535&t}function h(n,r){return n<<r|n>>>32-r}function s(n){for(var r=Array(),t=(1<<g)-1,e=0;e<n.length*g;e+=g)r[e>>5]|=(n.charCodeAt(e/g)&t)<<e%32;return r}function A(n){for(var r=d?"0123456789ABCDEF":"0123456789abcdef",t="",e=0;e<4*n.length;e++)t+=r.charAt(n[e>>2]>>e%4*8+4&15)+r.charAt(n[e>>2]>>e%4*8&15);return t}var d=0,g=8,v=function(n){return A(e(s(n),n.length*g))};t.exports=v});
;define('disk-share:widget/system/util/util.js', function(require, exports, module){ var context = require('system-core:context/context.js').instanceForSystem;

var Grid_Video = /^3gp$|^mpga$|^qt$|^rm$|^wmz$|^wmd$|^wvx$|^wmx$|^wm$|^mpeg$|^swf$|^mpg$|^wmv$|^rmvb$|^mpeg4$|^mp4$|^mpeg2$|^flv$|^avi$|^mkv$|^f4v$|^mov$|^vob$|^m4v$|^dat$|^m3u8$|^m3u$|^asf$|^3g2$|^mj2$|^ts$|^webm$/i;
var Music = /^wma$|^ra$|^ram$|^flac$|^ape$|^aiff$|^mp2$|^ogg$|^dts$|^aif$|^mpega$|^amr$|^mid$|^midi$|^wav$|^mp3$|^aac$|^ac3$|^m4a$/i;
var Grid_Picture = /^jpe$|^cur$|^svg$|^svgz$|^tif$|^tiff$|^ico$|^jpg$|^jpeg$|^gif$|^bmp$|^png$|^webp$|^heic$|^heif$|^avci$|^livp$|^cr2$|^arw$|^dng$|^nef$/i;
var Grid_ZIP = /^zip$|^rar$|^7z$|^cab$|^iso$/i;
var Grid_EXE = /^exe$|^msi$/i;
var Grid_Apple = /^ipa$/i;
var Grid_Android = /^apk$/i;
var Grid_Text = /^rtf$|^txt$/i;
var Grid_Excel = /^xls$|^xlsx$|^xlt$|^xltx$|^csv$/i;
var Grid_Word = /^dot$|^dotx$|^doc$|^docx$/i;
var Grid_PPT = /^pps$|^pot$|^ppsx$|^potx$|^ppt$|^pptx$/i;
var Grid_PDF = /^pdf$/i;
var Grid_Visio = /^vsd$/i;
var Grid_BT = /^torrent$/i;
var Grid_CAD = /^dwt$|^dwg$|^dws$|^dxf$/i;
var Grid_Keynote = /^key^/i;
var Numbers = /^numbers$/i;
var Pages = /^pages$/i;
var PanD = /^PanD$/i;

module.exports = {
    toFriendlyFileSize: function (size, isBit) {
        var B = 1024;
        var K = B * B; // 1024^2
        var M = K * B; // 1024^3
        var G = M * B; // 1024^4;
        var LG = M * 1000; // 1024^3 * 1000
        var BG = M * 10000;
        if (isBit && typeof size === 'number') {
            size = size / 8;
        }
        if (typeof size === 'number' || (typeof size === 'string' && /^[\d.]+$/.test(size))) {
            if (size < B) {
                size = Math.round(size) + 'B';
            } else if (size < K) {
                size = Math.round(size / B) + 'KB';
            } else if (size < M) {
                size = (size / K).toFixed(1) + 'M';
            } else if (size < LG) {
                size = (size / M).toFixed(1) + 'G';
            } else if (size < BG) {
                size = Math.round(size / M) + 'G';
            } else {
                size = Math.round(size / G) + 'T';
            }
        } else {
            size = '-';
        }
        size = size.replace('.0', '');
        return size;
    },

    getFirstWord: function (name) {
        if (name) {
            return name.substr(0, 1).toLocaleUpperCase();
        }
        return '';
    },

    getSearch: function (key) {
        return ((location.search || '').match(new RegExp('[?&]' + key + '=([^&]+)')) || [])[1] || '';
    },

    // 预览音频，未登录情况下引导登录
    makePreviewMusicLogin: function () {
        context.log.send({
            name: 'web_share_list_preview_music_dialog',
            value: {
                value: '外链未登录预览音频-引导登录弹窗展示',
            }
        });
        context.ui.tip({
            mode: 'caution',
            msg: '您还未登录，请登录后预览',
            sticky: false
        });
        window.yunHeader.login.util.loginNew();
        window.yunHeader.on('loginSuccess', function (args) {
            // 登录成功重新加载页面
            context.log.send({
                name: 'web_share_list_preview_music_login_succ',
                value: {
                    value: '外链未登录预览音频-引导登录成功',
                }
            });
            location.reload();
        });
    },
    // 企业权限
    ePermissions: {
        transfer: {
            code: 14,
            name: '外链转存'
        },
        createDir: {
            code: 5,
            name: '新建文件夹'
        }
    },
    // 企业可新建&可转存权限
    eAllPermissions: function () {
        return [this.ePermissions.transfer.code, this.ePermissions.createDir.code];
    },
    // @param {Array} permitOpList
    // @return {Boolean} 是否可转存
    eCanTransfer: function (permitOpList) {
        return permitOpList.indexOf(this.ePermissions.transfer.code) >= 0;
    },
    // @param {Array} permitOpList
    // @return {Boolean} 是否可新建文件夹
    eCanCreateDir: function (permitOpList) {
        return permitOpList.indexOf(this.ePermissions.createDir.code) >= 0;
    },
    getIconByExt: function (path) {
        var docReg = /(.*)\.(doc|docx|dot|dotx|rtf|ots|odm|odt)$/i;
        var xlsReg = /(.*)\.(xls|xlsx|xlt|xltx|ots|ods|csv)$/i;
        var singleReg = /(.*)\.(txt|pdf|apk|exe|psd|torrent|mmap|mm|xmind|numbers|pages|link|vsd)$/i;
        var pptReg = /(.*)\.(ppt|pptx|ppst|potx|pps|pot)$/i;
        // eslint-disable-next-line
        var htmlReg = /(.*)\.(vue|html|htm|xhtml|xml|sh|md|as|c|cpp|h|cs|asp|pas|diff|patch|erl|groovy|java|jsp|json|pl|php|py|rb|sass|scss|scala|sql|vb|less|lua|go|bat|wml|cc|ejs)$/i;
        var cssReg = /(.*)\.(css|less|sass)$/i;
        var jsReg = /(.*)\.(js|ts|jsx|tsx)$/i;
        var fontReg = /(.*)\.(eot|otf|fon|font|ttf|ttc|woff|woff2)$/i;
        var zipReg = /(.*)\.(zip|rar|7z|gz|tgz|tar)$/i;
        // eslint-disable-next-line max-len
        var musicReg = /(.*)\.(mp3|aac|wav|wma|amr|asf|asx|aac\+|eaac\+|mp2|ogg|aif|mpega|m4a|3gpp|ac3|ape|flac|m2a|ram)$/i;
        var cadReg = /(.*)\.(dwg|dxf|dwt|dwl|dwl2)$/i;
        var imageReg = /(.*)\.(jpg|jpeg|png|png8|png24|gif|svg|bmp|webp)$/i;
        var videoReg = /(.*)\.(mp4|flv|swf|fla|avi|flv|mpg|rm|mov|mkv|rmvb)$/i;
        var typeMap = {
            audio: musicReg,
            word: docReg,
            excel: xlsReg,
            single: singleReg,
            ppt: pptReg,
            html: htmlReg,
            css: cssReg,
            js: jsReg,
            font: fontReg,
            compress: zipReg,
            cad: cadReg,
            image: imageReg,
            video: videoReg
        };
        var icon = 'other';
        Object.keys(typeMap).some(function (key) {
            var reg = typeMap[key];
            if (reg.test(path)) {
                if (key === 'single') {
                    var types = path.split('.');
                    icon = types[types.length - 1];
                } else {
                    icon = key;
                }
                return true;
            }
        });
        return icon.toLowerCase();
    },
    operateShareListButtonStyle: function (that) {
        var selecedItems = that.getCheckedItems();
        if (!selecedItems.length) {
            return;
        }
        // 处理有云打印按钮后下载的的样式
        var fileName = selecedItems[0].server_filename;
        var fileExt = fileName.substring(fileName.lastIndexOf('.') + 1);
        var downloadBtn = $('.share-list .g-button.tools-share-V20-btn[title="下载"]');
        if (!downloadBtn.length) {
            return;
        }
        if (selecedItems.length === 1 && 'ppt,pptx,pdf,doc,docx'.indexOf(fileExt.toLowerCase()) > -1) {
             // 自己的链接
            if (window.locals.get('self')) {
                downloadBtn.addClass('first_btn').removeClass('last_btn').removeClass('hassep');
                downloadBtn[0].style.setProperty('border-top-right-radius', '');
                downloadBtn[0].style.setProperty('border-bottom-right-radius', '');
                return;
            }
            downloadBtn[0].style.setProperty('border-radius', '0', 'important');
        } else {
            if (window.locals.get('self')) {
                downloadBtn.addClass('first_btn').addClass('last_btn').removeClass('hassep');
                downloadBtn[0].style.setProperty('border-top-right-radius', '16px', 'important');
                downloadBtn[0].style.setProperty('border-bottom-right-radius', '16px', 'important');
                return;
            }
            downloadBtn.css({
                'border-radius': 'none'
            });
            downloadBtn[0].style.setProperty('border-radius', '');
        }
    },
    // 根据文件后缀获取文件icon
    getIconType: function (fileSuffix, isDir = false) {
        if (!fileSuffix) {
            return 'Grid_Misc';
        }
        var extname = fileSuffix.toLowerCase();
        var type;
        if (isDir) {
            type = 'Grid_Folder';
        } else {
            switch (true) {
                case Grid_Video.test(extname):
                    type = 'Grid_Video';
                    break;
                case Music.test(extname):
                    type = 'Grid_Audio';
                    break;
                case Grid_Picture.test(extname):
                    type = 'Grid_Picture';
                    break;
                case Grid_ZIP.test(extname):
                    type = 'Grid_ZIP';
                    break;
                case Grid_EXE.test(extname):
                    type = 'Grid_EXE';
                    break;
                case Grid_Apple.test(extname):
                    type = 'Grid_Apple';
                    break;
                case Grid_Android.test(extname):
                    type = 'Grid_Android';
                    break;
                case Grid_Text.test(extname):
                    type = 'Grid_Text';
                    break;
                case Grid_Excel.test(extname):
                    type = 'Grid_Excel';
                    break;
                case Grid_Word.test(extname):
                    type = 'Grid_Word';
                    break;
                case Grid_PPT.test(extname):
                    type = 'Grid_PPT';
                    break;
                case Grid_PDF.test(extname):
                    type = 'Grid_PDF';
                    break;
                case Grid_Visio.test(extname):
                    type = 'Grid_Visio';
                    break;
                case Grid_BT.test(extname):
                    type = 'Grid_BT';
                    break;
                case Grid_CAD.test(extname):
                    type = 'Grid_CAD';
                    break;
                case Grid_Keynote.test(extname):
                    type = 'Grid_Keynote';
                    break;
                case Numbers.test(extname):
                    type = 'Numbers';
                    break;
                case Pages.test(extname):
                    type = 'Pages';
                    break;
                case PanD.test(extname):
                    type = 'PanD';
                    break;
                default:
                    type = 'Grid_Misc';
                    break;
            }
        }
        return type;
    }
}; 
});
;define("disk-share:widget/system/errorMsg/errorMsg.js",function(a){var e=a("system-core:context/context.js").instanceForSystem,r={0:"成功","-1":"由于您分享了违反相关法律法规的文件，分享功能已被禁用，之前分享出去的文件不受影响。","-2":"用户不存在,请刷新页面后重试","-3":"文件不存在,请刷新页面后重试","-4":"登录信息有误，请重新登录试试","-5":"host_key和user_key无效","-6":"请重新登录","-7":"该分享已删除或已取消","-8":"该分享已经过期","-9":"访问密码错误","-10":"分享外链已经达到最大上限100000条，不能再次分享","-11":"验证cookie无效","-14":"对不起，短信分享每天限制20条，你今天已经分享完，请明天再来分享吧！","-15":"对不起，邮件分享每天限制20封，你今天已经分享完，请明天再来分享吧！","-16":"对不起，该文件已经限制分享！","-17":"文件分享超过限制","-21":"预置文件无法进行相关操作","-30":"文件已存在","-31":"文件保存失败","-33":"一次支持操作999个，减点试试吧","-32":"你的空间不足了哟","-70":"你分享的文件中包含病毒或疑似病毒，为了你和他人的数据安全，换个文件分享吧",2:"参数错误",3:"未登录或帐号无效",4:"存储好像出问题了，请稍候再试",108:"文件名有敏感词，优化一下吧",110:"分享次数超出限制，可以到“我的分享”中查看已分享的文件链接",114:"当前任务不存在，保存失败",115:"该文件禁止分享",112:'页面已过期，请<a href="javascript:window.location.reload();">刷新</a>后重试',9100:'你的帐号存在违规行为，已被冻结，<a href="/disk/appeal" target="_blank">查看详情</a>',9200:'你的帐号存在违规行为，已被冻结，<a href="/disk/appeal" target="_blank">查看详情</a>',9300:'你的帐号存在违规行为，该功能暂被冻结，<a href="/disk/appeal" target="_blank">查看详情</a>',9400:'你的帐号异常，需验证后才能使用该功能，<a href="/disk/appeal" target="_blank">立即验证</a>',9500:'你的帐号存在安全风险，已进入保护模式，请修改密码后使用，<a href="/disk/appeal" target="_blank">查看详情</a>',90003:"暂无文件夹管理权限"};e.extendErrorMsg(r)});
;define("disk-share:widget/system/fileOperate/fileCreateAndMove.js",function(e,t,i){function s(e,t,i,s,o){for(var a,c,l=[],p=null,f=0,h=t.length;h>f;f++)p=t[f].path,a=r.tools.baseService.parseDirPath(p),c=r.tools.baseService.parseDirFromPath(p),l.push({path:a,dest:i,newname:c});n.post("/api/filemanager?channel=chunlei&clienttype=0&web=1&opera="+e,{filelist:n.stringify(l)},s,"json").error(o)}function o(e,t,i,s,o,c){var l,p,f=r.tools.baseService.parseDirFromPath(e),h="";if(a.test(f))return h="文件名不能包含以下字符：<,>,|,*,?,,/",c(h),!1;if(f.length>0){for(p=0,l=0;p<f.length;p++)f.charCodeAt(p)<128?l++:l+=2;l>255&&(h="文件(夹)名称长度不能超过255字节",c(h))}else h="文件(夹)名称不能为空，请输入文件名称",c(h);h||n.post("/api/create?a=commit",{path:e,isdir:i,size:t,block_list:s?'["'+s+'"]':"[]",method:"post"},o,"json")}var n=e("base:widget/libs/jquerypacket.js"),r=e("system-core:context/context.js").instanceForSystem,a=/[\\\/:*?'<>|]/i;i.exports.createAndMoveTo=function(e,t,i,n){o(e,"",1,null,function(){setTimeout(function(){s("copy"+i,t,e,n)},1e3)})}});
;define('disk-share:widget/system/fileOperate/fileOperate.js', function(require, exports, module){ /**
 * this file is used to return the file's icon and the operate plugin
 * author shaoyifeng
 */
var tools = require('base:widget/tools/tools.js');
var instanceForSystem = require('system-core:context/context.js').instanceForSystem;
var pluginControl = instanceForSystem.pluginControl;
var Registry = pluginControl.Registry;
var fileIcon = pluginControl.BrokerData.getAllData().fileIcon;

/**
 * return the file's icon and the operate plugin
 * @param  {string} filePath the path and name of the file
 * @param  {string} isDir
 * @param  {boolean} returnPluginId 插件是否以ID的形式返回
 * @param  {string} isMulti 是否是多文件图标
 * @param  {string} isShare 是否是共享文件图标
 * @return {object} include file's icon and the operate plugin
 */
module.exports.getInfo = function (filePath, isDir, returnPluginId, isMulti, isShare, wpfile) {
    filePath = filePath || '';

    var fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    var tempInfo = {
        fileName: fileName,
        name: tools.toEntity(fileName)
    };

    // 多文件图标
    if (isMulti) {
        tempInfo.smallIcon = 'dir-multi-small';
        tempInfo.middleIcon = 'dir-multi-middle';
        tempInfo.largeIcon = 'dir-multi-large';
        return tempInfo;
    }

    if (isDir) {
        // 文件夹
        if (filePath.match(/^\/apps$/)) {
            tempInfo.smallIcon = 'dir-apps-small';
            tempInfo.largeIcon = 'dir-apps-large';
            tempInfo.middleIcon = 'dir-apps-middle';
            tempInfo.name = '我的应用数据';
            return tempInfo;
        }
        if (filePath.match(/^\/百度云收藏$/)) {
            tempInfo.smallIcon = 'dir-cang-small';
            tempInfo.largeIcon = 'dir-cang-large';
            tempInfo.middleIcon = 'dir-cang-middle';
            tempInfo.name = '我的收藏';
            return tempInfo;
        }
        if (filePath.match(/^\/来自PC的备份文件$/)) {
            tempInfo.smallIcon = 'dir-backup-small';
            tempInfo.largeIcon = 'dir-backup-large';
            tempInfo.middleIcon = 'dir-backup-middle';
            return tempInfo;
        }
        if (filePath.match(/^\/apps\//)
            || filePath.match(/^\/百度云收藏\//)
            || filePath.match(/^\/来自PC的备份文件\//)) {
            tempInfo.smallIcon = 'dir-app-small';
            tempInfo.largeIcon = 'dir-app-large';
            tempInfo.middleIcon = 'dir-app-middle';
            return tempInfo;
        }
        if (filePath.match(/^cardHolder/)) {
            tempInfo.smallIcon = 'dir-card-small';
            tempInfo.largeIcon = 'dir-card-large';
            tempInfo.middleIcon = 'dir-card-middle';
            tempInfo.name = '我的卡包';
            return tempInfo;
        }
        // 共享目录及其子文件夹都要显示成共享图标
        if (filePath.match(/^shareHolder/)) {
            tempInfo.smallIcon = 'dir-share-small';
            tempInfo.largeIcon = 'dir-share-large';
            tempInfo.middleIcon = 'dir-share-middle';
            tempInfo.name = '共享给我的文件夹';
            return tempInfo;
        }
        if (isShare) {
            tempInfo.smallIcon = 'dir-share-small';
            tempInfo.largeIcon = 'dir-share-large';
            tempInfo.middleIcon = 'dir-share-middle';
            return tempInfo;
        }

        tempInfo.smallIcon = 'dir-small';
        tempInfo.largeIcon = 'dir-large';
        tempInfo.middleIcon = 'dir-middle';
        return tempInfo;
    }
    if (+wpfile === 1) {
        tempInfo.smallIcon = 'wp-small';
        tempInfo.largeIcon = 'wp-large';
        tempInfo.middleIcon = 'wp-middle';
        return tempInfo;
    }
    let isFcb = filePath.toLowerCase().endsWith('.fcb');
    if (isFcb) {
        tempInfo.smallIcon = 'fcb-small';
        tempInfo.largeIcon = 'fcb-large';
        tempInfo.middleIcon = 'fcb-middle';
        return tempInfo;
    }

    // 非文件夹
    tempInfo.largeIcon = 'default-large';
    tempInfo.smallIcon = 'default-small';
    tempInfo.middleIcon = 'default-middle';

    var fileExtension = filePath.lastIndexOf('.') !== -1 ? tools.getFileCategory(filePath) : '*';
    // 设置了icon
    if (fileIcon[fileExtension]) {
        if (fileIcon[fileExtension].length === 3) {
            tempInfo.smallIcon = fileIcon[fileExtension][0];
            tempInfo.largeIcon = fileIcon[fileExtension][1];
            tempInfo.middleIcon = fileIcon[fileExtension][2];
        } else if (fileIcon[fileExtension].length === 2) {
            tempInfo.smallIcon = fileIcon[fileExtension][0];
            tempInfo.largeIcon = fileIcon[fileExtension][1];
        } else {
            tempInfo.smallIcon = fileIcon[fileExtension];
            tempInfo.largeIcon = fileIcon[fileExtension];
        }
    }

    // 返回插件ID，字符串
    var pluginStr = Registry.getDefaultPluginIdByExtension(fileExtension);
    if (!returnPluginId && pluginStr) {
        // 如果没有声明以id的形式返回，并且插件是存在的，则以名字+组的形式返回
        pluginStr = Registry.getPluginById(pluginStr).name + '' + '@' + Registry.getOtherInfoById(pluginStr).group;
    }
    tempInfo.plugin = pluginStr;

    return tempInfo;
};


var whiteList = [
    'dir', 'multi', 'shouchang', 'yingyong', 'yingyong_child', 'beifen',

    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt',

    'jpg', 'jpeg', 'gif', 'bmp', 'png', 'jpe', 'cur', 'svg', 'svgz', 'tif', 'tiff', 'ico',

    'wma', 'wav', 'mp3', 'aac', 'ra', 'ram', 'mp2', 'ogg', 'aif', 'mpega', 'amr', 'mid', 'midi', 'm4a',

    'wmv', 'rmvb', 'mpeg4', 'mpeg2', 'flv', 'avi', '3gp', 'mpga', 'qt', 'rm', 'wmz', 'wmd', 'wvx', 'wmx',
    'wm', 'swf', 'mpg', 'mp4', 'mkv', 'mpeg', 'mov', 'asf', 'zip', 'rar',

    'torrent'
];
/**
 * isOpenedFile 判断是否支持预览
 * @param  {string} extName
 * @param  {string} inShare
 */
module.exports.isOpenedFile = function (extName, inShare) {
    // 共享目录不支持种子torrent
    if (inShare && extName === 'torrent') {
        return false;
    }
    return whiteList.indexOf(extName) >= 0;
};
 
});
;define("disk-share:widget/system/util/contextExtend.js",function(e){window.metaData={};var i=window.locals.get("file_list");if(i){var t=e("base:widget/tools/service/tools.format.js").toFriendlyFileSize,r=i[0]||{};window.metaData.file=r,window.metaData.FIRST_FILE_SIZE=r.size?t(r.size):0,window.metaData.FS_ID=r.fs_id+"",window.metaData.FILENAME=r.server_filename}var n=e("system-core:context/context.js").instanceForSystem,o=e("disk-share:widget/system/fileOperate/fileOperate.js"),s=e("disk-share:widget/system/fileOperate/fileCreateAndMove.js"),a=e("system-core:system/uiService/log/log.js"),l=n.ui.list;e("disk-share:widget/system/errorMsg/errorMsg.js"),n.extend({file:{getIconAndPlugin:function(e,i,t){return o.getInfo(e,i,!1,t)},isOpenedFile:function(e,i){return o.isOpenedFile(e,i)},getFileInfo:function(e,i,t,r,n){return o.getInfo(e,i,t,r,n)},createAndMoveTo:s.createAndMoveTo,getPreviewLinkInShare:function(e,i){if(e.newdocpreview)return i(null,e.newdocpreview);var t=window.location.pathname.split("/s/"),r="";t.length>1&&(r=decodeURIComponent(localStorage.getItem(t[1]+"_bdclnd")||"")),$.ajax({url:"/share/list",data:{is_from_web:!!r,sekey:r,uk:window.locals.get("share_uk"),shareid:window.locals.get("shareid"),web:1,newdocpreview:1,fid:e.fs_id},dataType:"json",success:function(t){0===t.errno?(e.newdocpreview=t.list[0].newdocpreview,i(null,e.newdocpreview)):i(new Error("meet some error"))},error:function(e){i(new Error(e))}})}},ui:{list:function(e,i){var t=l(e,i);return t.extend({resizeScrollBar:function(e){var i=this.$container;if("number"==typeof e||"string"==typeof e?i.height(e):e=i.height(),0===e)throw"[Error] list container's height is 0, need to set";i.height(e);var t=this.listHeader.hasInit===!1?0:52;"none"===i.find(".JDeHdxb").css("display")?(i.find(".NHcGw").height(e-t).find(".scrollbar-tracker").height(e-t-2),i.find(".BNfIyPb").height(e-t).find(".scrollbar-tracker").height(e-t-2)):(i.find(".NHcGw").height(e-73).find(".scrollbar-tracker").height(e-73),i.find(".BNfIyPb").height(e-73).find(".scrollbar-tracker").height(e-73))}}),t}},pageInfo:{currentProduct:"share",currentPage:"share-multi"}}),window.locals.get("Elink_info",function(e){e&&e.isElink&&a.extendDefaultParams({sourceFrom:"enterprise_web_sharelink"})})});
;define("disk-share:widget/system/util/logs/agentLog.js",function(e,o,n){function a(e,o){if(o||(o={}),e){var n=t[e];n.ext=o,i.sendLog(n)}}var t={commonBase:{serverId:19071,from:"video",page:"agent_connection",parasitifer:"web",appname:"wangpan"},codePageShow:{type:"display",value:"code",comment:"web外链输入提取码页展现"},codeSuccessPageShow:{type:"display",value:"detail",comment:"web外链提取码成功展现"},sharepageClickDownload:{type:"click",value:"topc",comment:"外链点击下载"}},c=window.BpData;c||(c=function(){},c.prototype.sendLog=function(){});var i=new c(t.commonBase);n.exports.sendlog=function(e,o){setTimeout(function(){a(e,o)},0)}});
;define("disk-share:widget/system/util/getAdList/fetchAjax.js",function(e,t,i){function s(e,t,i,s){var n=d(a+e+t+i.request_id+i.list[0].id);return e+";"+i.request_id+";"+i.list[0].id+";"+s+";"+n}var n=e("base:widget/libs/jquerypacket.js"),d=e("disk-share:widget/system/util/getAdList/MD5.js"),a="3c27ad3f861ecfd7";i.exports=function(e,t,i,r){var c=0,u=t.list,o=e||"/rest/2.0/pcs/adx",g={},l=function(e,i,r){if(c>u.length-1)return void e({errno:0,data:r});var g=(new Date).getTime(),f=u[c].id,v=d(a+g+f),j={m:"pos",d:"web",p:f,s:g+";"+v,uk:t.uk||window.locals.get("uk"),time:g},p=n.extend({},j,u[c]);n.ajax({type:"GET",url:o,dataType:"json",data:p,success:function(t){r[f]=n.extend({},t),t.list&&(r[f].csign=s(g,f,t,"c"),r[f].vsign=s(g,f,t,"v")),c++,l(e,i,r)},error:function(t){r[f]=n.extend({},t),t.list&&(r[f].csign=s(g,f,t,"c"),r[f].vsign=s(g,f,t,"v")),c++,l(e,i,r)}})};l(i,r,g)}});
;define("disk-share:widget/system/util/logs/bottomShareLog.js",function(e,o,a){function t(e,o){if(o||(o={}),e){var a=n[e];a.ext=o,s.sendLog(a)}}var n=(e("base:widget/libs/underscore.js"),{commonBase:{serverId:19005,from:"net_basics",page:"share_common_page",parasitifer:"web",appname:"wangpan"},goSaveDis:{type:"display",value:"go_save_dis",comment:"立即保存入口展现"},goSaveClk:{type:"click",value:"go_save_clk",comment:"点击立即保存"},downloadDis:{type:"display",value:"download_dis",comment:"下载入口展现"},downloadClk:{type:"click",value:"download_clk",comment:"下载入口点击"},pathDis:{type:"display",value:"path_dis",comment:"路径展现"},pathClk:{type:"click",value:"path_clk",comment:"路径点击，即唤起选择面板"},fileOpreation:{type:"display",value:"file_operation",comment:"操作文件"},fileOpreationResult:{type:"display",value:"file_operation_result",comment:"操作文件结果"}}),i=window.BpData;i||(i=function(){},i.prototype.sendLog=function(){});var s=new i(n.commonBase);a.exports.sendlog=function(e,o){setTimeout(function(){t(e,o)},0)}});
;define("disk-share:widget/system/util/adPlatform/adPlatform.tpl.js",function(i,t,a){var n={alljs:["<%= content %>"].join(""),singletext:["<%for(var i=0; i < info.length; i++){%>","<% var item = info[i]%>","<% if (item.ad_warn) {%>",'<sapn class="ad-warn">',"<%- item.ad_warn %>","</sapn>","<%}%>","<% if (item.close) {%>",'<sapn class="ad-close">close</sapn>',"<%}%>",'<a target="<%- isTarget(item.action.action)%>"href="<%- item.action.action %>" title="<%- item.content %>">',"<%- item.content %>","</a>","<%}%>"].join(""),singleimage:["<%for(var i=0; i < info.length; i++){%>","<% var item = info[i]%>","<% if (item.ad_warn) {%>",'<sapn class="ad-warn">',"<%- item.ad_warn %>","</sapn>","<%}%>","<% if (item.close) {%>",'<sapn class="ad-close">close</sapn>',"<%}%>",'<a target="<%- isTarget(item.action.action)%>"href="<%- item.action.action %>" title="<%- item.action.param.title %>"',' style="background:url(<%- item.content %>) center no-repeat;height:<%- imgs %>;display:block;">',"</a>","<%}%>"].join(""),multiimage:["<%for(var i=0; i < info.length; i++){%>","<% var item = info[i]%>",'<a target="<%- isTarget(item.action.action)%>"href="<%- item.action.action %>" title="<%- item.action.param.title %>"',' style="display:block;position:absolute;width: 898px;left: 50%;margin-left: -449px;">','<img src="<%- item.content %>" class="share-center" />',"<% if (item.ad_warn) {%>",'<sapn class="ad-warn">',"<%- item.ad_warn %>","</sapn>","<%}%>","<% if (item.close) {%>",'<sapn class="ad-close">close</sapn>',"<%}%>","</a>","<%}%>"].join(""),video:["<video>",'<source src="<%- info.content %>">',"</video>"].join(""),wangmengAside:['(window["cproStyleApi"] = window["cproStyleApi"] || {})','[ "u2380627" ]={at:"3",rsi0:"200",rsi1:"200",pat:"17",tn:"baiduCustNativeAD",','rss1:"#FFFFFF",conBW:"1",adp:"1",ptt:"0",','titFF:"%E5%BE%AE%E8%BD%AF%E9%9B%85%E9%BB%91",','titFS:"",rss2:"#000000",titSU:"0"};',"(window.cproArray = window.cproArray || []).push({",'id: "u2380627"',"});"].join(""),wangmengSingle:["(window.cproArray = window.cproArray || []).push({",'id: "u2493175"',"});"].join(""),wangmengBottom:["(window.cproArray = window.cproArray || []).push({",'id: "u2164871"',"});"].join("")};a.exports=n});
;define("disk-share:widget/system/util/adPlatform/adPlatformService.js",function(e,t,a){var n=e("base:widget/libs/jquerypacket.js"),i=e("base:widget/libs/underscore.js"),r=e("system-core:context/context.js").instanceForSystem,o=e("disk-share:widget/system/util/adPlatform/adPlatform.tpl.js"),d={init:function(){d.dealWithAdShow(),d.eventInit()},getFirstItemByNodeId:function(e){return(d.data[e].list||[])[0]||{}},dealWithAdShow:function(){var e=this;i.each(d.data,function(t,a){if(e.checkAd(t))return void(("web-sharelinkpic"===a||"web-sharesinglebanner"===a||"web-sharemultibanner"===a)&&e.createScript(a));var n=t.list&&t.list[0]?t.list[0].type.toLowerCase():"image";d.dealSingleAd(a,n)}),n(".ad-platform-tips").is(":visible")&&r.message.trigger("ad-share-list-single-show")},checkAd:function(e){return null===e||e&&e.error_code},createScript:function(e){var t=document.createElement("div"),a=document.createElement("script"),n=document.createElement("script");if(""===a.innerHTML||""===a.innerHTML)return!1;var i={"web-sharelinkpic":{shareIdStr:"web-right-view",uid:"u2380627",shareTpl:"wangmengAside"},"web-sharesinglebanner":{shareIdStr:"web-single-bottom",uid:"u2493175",shareTpl:"wangmengSingle"},"web-sharemultibanner":{shareIdStr:"web-multi-bottom",uid:"u2164871",shareTpl:"wangmengBottom"}},r=document.getElementById(i[e].shareIdStr||"web-right-view");a.innerHTML=o[i[e].shareTpl||"wangmengAside"],a.type=n.type="text/javascript",n.src=window.location.protocol+"//cpro.baidustatic.com/cpro/ui/c.js",t.id="cpro_"+(i[e].uid||"u2380627"),r.appendChild(t);var d=document.getElementById("cpro_"+(i[e].uid||"u2380627"));d.appendChild(a),d.appendChild(n),a=null,n=null},formatHTTP:function(e){return i.isArray(e)&&e.length>0&&e[0].content?e[0].content=e[0].content.replace(/https?:/gi,window.location.protocol):i.isString(e)&&(e=e.replace(/https?:/gi,window.location.protocol)),e},dealSingleAd:function(e,t){var a="",r=n('.ad-platform-tips[node-id~="'+e+'"]');if("js"===t){var s=d.getFirstItemByNodeId(e);if("baichuan"===s.uid){var l="";l="web-sharemultibanner"===e?['<div style="margin: 0 auto; width: 960px;">',d.base64decode(s.content),"</div>"].join(""):d.base64decode(s.content),r.html(l)}else{t="all"+t;var c=document.createElement("div"),p=document.createElement("script"),u=document.createElement("script");u.type="text/javascript",u.src=window.location.protocol+"//cpro.baidustatic.com/cpro/ui/c.js";var h=i.template(o[t])({content:d.base64decode(s.content)});c.id="cpro_"+(s.uid||"u2380627"),"web-sharemultibanner"===e&&(c.style="margin: 0 auto; width: 960px;"),p.innerHTML=h,r.append(c);var m=n("#cpro_"+(s.uid||"u2380627"));m.append(p),m.append(u),p=null,u=null}}else{"web-sharemultibanner"===e?(t="multi"+t,a=d.data["web-sharelinkrepeat"].list?d.formatHTTP(d.data["web-sharelinkrepeat"].list[0].content):null):(t="single"+t,a="web-sharelinkpic"===e?"200px":"90px");var h=i.template(o[t])({info:d.formatHTTP(d.data[e].list)||[],imgs:a,isTarget:function(e){return-1!==["#","javascript:;","javascript:void(0);"].indexOf(e)?"":"_blank"}});r.append(h)}this.sendViewCallback(e)},eventInit:function(){d.adPlatformTips.on("click",function(e){if(n(e.target).hasClass("ad-close"))n(e.target).parents(".ad-platform-tips").hide(),e&&e.preventDefault(),r.log.send({type:"web_ad_click_close"});else{var t=n(this).attr("node-id");d.sendClickCallback(t)}})},base64decode:function(e){var t,a,n,i,r,o,d,s=[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,-1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1];for(o=e.length,r=0,d="";o>r;){do t=s[255&e.charCodeAt(r++)];while(o>r&&-1===t);if(-1===t)break;do a=s[255&e.charCodeAt(r++)];while(o>r&&-1===a);if(-1===a)break;d+=String.fromCharCode(t<<2|(48&a)>>4);do{if(n=255&e.charCodeAt(r++),61===n)return d;n=s[n]}while(o>r&&-1===n);if(-1===n)break;d+=String.fromCharCode((15&a)<<4|(60&n)>>2);do{if(i=255&e.charCodeAt(r++),61===i)return d;i=s[i]}while(o>r&&-1===i);if(-1===i)break;d+=String.fromCharCode((3&n)<<6|i)}return d},sendCallback:function(e,t){var a=(new Date).getTime()+e;window[a]=new Image;var n=window[a];if(e){var i=0,r=0;switch(e){case"web-sharelinkpic":i=200,r=200;break;case"web-sharemultibanner":r=910,i=90;break;case"web-sharesinglebanner":r=710,i=90;break;default:return}var o="&h="+i+"&w="+r+"&p="+(e||"web-text")+"&s="+encodeURIComponent(t),d=window.host&&window.host.HOST_PAN||"pan.baidu.com",s="//"+d+"/rest/2.0/pcs/adx?m=callback"+o;n.onload=n.onerror=function(){window[a]=null},n.src=s,n=null}},sendViewCallback:function(e){var t=d.getFirstItemByNodeId(e);r.log.send({type:"web_show_"+(t.id||"")}),this.sendCallback(e,d.data[e].vsign)},sendClickCallback:function(e){var t=d.getFirstItemByNodeId(e);r.log.send({type:"web_click_"+(t.id||"")}),this.sendCallback(e,d.data[e].csign)}};a.exports.init=function(e){e||(e={}),d.data=e.data||{},d.adPlatformTips=e.AdPlatformTips||{},d.init()}});
;define("disk-share:widget/system/singleFileComment/singleFileComment.js",function(e){var n=e("base:widget/libs/jquerypacket.js");window.locals.get("pansuk","share_uk","shareid",function(o,s,t){var a={source_uk:s,source_id:t,type:0,avatar_url:window.locals.get("photo"),uname:window.locals.get("username"),current_uk:window.locals.get("uk"),pansuk:o,login_status:window.locals.get("loginstate"),domType:1,limit:20,dialog:{hasBorder:!1,hasArraw:!1,hasScroll:!1},onLoadedCallBack:function(){disk.DEBUG&&console.log("loaded comment successed!")},onrefreshPage:function(){disk.DEBUG&&console.log("loaded comment successed ~~~!")},onLoadedTextarea:function(){}},l=n(".comment_panel");e.async("disk-share:widget/system/singleFileComment/commentPanel/commentPanel.js",function(e){var o=new e;o.startInit(l,a),o.getTotalCount=function(e){var o=e>999?"999+":e;n(".funcs-comment").text("评论("+o+")")}})})});
;define("disk-share:widget/system/util/adPlatform/adPlatform.js",function(t,i,a){"use strict";var o=t("base:widget/libs/jquerypacket.js"),r=t("disk-share:widget/system/util/adPlatform/adPlatformService.js"),e=t("disk-share:widget/system/util/getAdList/fetchAjax.js"),n=function(){this.AdPlatformTips=o(".ad-platform-tips"),this.config={},this.errorCount=0,this.data={}};n.prototype={getAdResoucre:function(t,i,a){var o=this;t||(t={list:[{id:"web-text",w:0,h:0}]}),t.uk=window.locals.get("uk"),o.data=t,e("/rest/2.0/pcs/adx",t,function(t){t?(i&&"function"==typeof i&&i.call(o,t),o.configInitData(t)):(o.errorCount++,a&&"function"==typeof a&&a.call(o,t),o.errorCallback(t))},function(t){o.errorCount++,a&&"function"==typeof a&&a.call(o,t),o.errorCallback(t)})},configInitData:function(t){this.config.data=t.data,this.config.AdPlatformTips=this.AdPlatformTips,r.init(this.config)},errorCallback:function(t){var i=this;t&&0!==t.errno&&1===i.errorCount&&(i.getAdResoucre(i.data),i.data=null)}},n.init=function(){return new n},a.exports=new n});
;define("disk-share:widget/system/util/getCookies.js",function(e,t,i){i.exports=function(e){for(var t=document.cookie.split(";"),i=0;i<t.length;i++){var o=t[i].split("=");if(o[0].trim()===e)return decodeURIComponent(o[1])}}});
;define("disk-share:widget/pageModule/share-file-main/fileType/picture/Rotater.js",function(t,i,e){var a=t("base:widget/libs/jquerypacket.js"),o=function(t,i){if(!(this instanceof o)){var e=new o(t,i);return e}this.init(t,i)};o.prototype.init=function(t,i){this.rotaterBox=a(t),this.image=this.rotaterBox.find("img"),this.leftButton=a(".left"+i.slice(1)),this.rightButton=a(".right"+i.slice(1)),this._setupData(),this._style(),this._bindEvent(i)},o.prototype._setupData=function(){this.leftButton.data("dir","-1"),this.rightButton.data("dir","1"),this.rotation=1,this.containerWidth=this.rotaterBox.width(),this.containerHeight=this.rotaterBox.height()},o.prototype._style=function(){this.rotaterBox.addClass("poorRotaterBox"),"absolute"!==this.rotaterBox[0].style.position&&(this.rotaterBox[0].style.position="relative"),this.imageStylePrefix=a.browser.msie&&parseInt(a.browser.version,10)<9?"ie":"",this.image.addClass(this.imageStylePrefix+"poorRotater-1"),this.image.animate({marginTop:this.image.height()/-2,marginLeft:this.image.width()/-2},function(){a(this).css("visibility","visible")})},o.prototype._bindEvent=function(t){var i=this;a(t).bind("click",function(){var t=parseInt(a(this).data("dir"),10),e=(i.rotation+t)%4,o=i.image.width(),s=i.image.height();0>=e&&(e+=4),i.image.removeClass(i.imageStylePrefix+"poorRotater-"+i.rotation).addClass(i.imageStylePrefix+"poorRotater-"+e),i.image.css(e%2===0&&o>i.containerHeight&&o>s?{width:i.containerHeight,height:"auto"}:{width:"auto",height:"auto"}),i.rotation=e,o=i.image.width(),s=i.image.height(),i.image.css({marginTop:s/-2,marginLeft:o/-2})})},e.exports=o});
;define('disk-share:widget/system/util/ab.js', function(require, exports, module){ /**
 * @file 峙一AB实验
 * @author: dongwanhong@baidu.com
 */

var scriptLoader = require('base:widget/pc-invoker/loadScript.js');

var scriptSrc = 'https://nd-static.bdstatic.com/m-static/base/thirdParty/ab/bp-abtest-jssdk.1.0.21.min.js';
var loader = scriptLoader.getLoader();

var pri = {
    getBpABTest: function(cb, errorCb) {
        return loader.load(scriptSrc, cb, errorCb);
    },
    getBpABTestInstance: function(productName, type) {
        type = type || 'BAIDU_ID';
        productName = productName || 'netdisk';

        return new Promise(function(resolve, reject) {
            pri.getBpABTest(function() {
                if (type === 'BAIDU_ID') {
                    resolve(window.BpABTest.getInstance(productName));
                } else {
                    resolve(window.BpABTest.getInstanceByUID(productName));
                }
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
    getInfoByKey(key, type) {
        return this.getBpABTestInstance('netdisk', type).then(bpABTest => {
            return bpABTest.getInfoByKey(key);
        });
    }
};

module.exports = pri;
 
});
;define("disk-share:widget/system/util/logs/pcInvoker.js",function(e,o,n){function t(e,o){if(o||(o={}),e){var n=a[e],t=[];i.getSidListArr().then(function(e){t=e}).finally(function(){n=$.extend({},n,o),n.ext=$.extend({},n.ext,{sidList:t}),c.sendLog(n)})}}function d(e,o,n){o=o||{},o.ext=o.ext||{},n=n||{},n.needExcitation?s.identifyIsTargetUser().then(function(n){o.ext.excitation=n?1:0,t(e,o)}).catch(function(){t(e,o)}):t(e,o)}var i=e("disk-share:widget/system/util/ab.js"),s=e("disk-share:widget/pageModule/share-header/back-client-motivation.js"),a={commonBase:{serverId:19509,from:"net_basics",page:"link_page",parasitifer:"web"},webEvoked:{type:"clk",value:"web_evoked",comment:"点击调端"},webEvokedSuccess:{type:"dis",value:"web_evoked_success",comment:"调端成功"},webEvokedBtnDis:{type:"dis",value:"web_evoked_btn_dis",comment:"调端按钮展现"},webVideoSaveEvokedDis:{type:"dis",value:"web_video_save_evoked",comment:"视频降级实验2点击保存并观看展现"},webVideoSaveEvokedClk:{type:"clk",value:"web_video_save_evoked",comment:"视频降级实验2点击保存并观看点击"},webVideoEvoked1Dis:{type:"dis",value:"web_video_evoked_1",comment:"视频降级实验3展现"},webVideoEvoked1Clk:{type:"clk",value:"web_video_evoked_1",comment:"视频降级实验3点击"},webVideoEvokedSuccess:{type:"dis",value:"web_video_evoked_success",comment:"视频降级实验调端成功"},webVideoEvokedDownload:{type:"dis",value:"web_video_evoked_download",comment:"视频降级实验下载端"},webDownloadBanner:{type:"dis",value:"web_download_banner",comment:"调端激励banner展"},webDownloadBannerClk:{type:"clk",value:"web_download_banner",comment:"调端激励banner点"}},v=window.BpData;v||(v=function(){},v.prototype.sendLog=function(){});var c=new v(a.commonBase);n.exports.send=function(e,o,n){setTimeout(function(){d(e,o,n)},0)}});
;define("disk-share:widget/system/util/log.js",function(e,t,a){function n(e,t){if(t||(t={}),e){var a=l[e],n=[];i.getSidListArr().then(function(e){n=e}).finally(function(){a.ext=$.extend({},t,{sidList:n}),y.sendLog(a)})}}var i=(e("base:widget/libs/underscore.js"),e("disk-share:widget/system/util/ab.js")),l={commonBase:{serverId:19005,from:"video",page:"video_view_page",parasitifer:"web",appname:"wangpan"},videoPlayerDis:{type:"display",value:"video_player_dis",comment:"视频播放器展现"},tryPalyDis:{type:"display",value:"try_paly_dis",comment:"试看保存浮条展现"},tryPalyClk:{type:"clk",value:"try_paly_clk",comment:"试看保存浮条点击"},tryPalyCloseClk:{type:"clk",value:"try_paly_close_clk",comment:"试看保存浮条点击关闭"},tryEndDis:{type:"display",value:"try_end_dis",comment:"播放结束按钮展现"},tryEndSaveClk:{type:"display",value:"try_end_save_clk",comment:"播放结束点击保存"},tryEndReplayClk:{type:"display",value:"try_end_replay_clk",comment:"播放结束点击重新播放"}},s=window.BpData;s||(s=function(){},s.prototype.sendLog=function(){});var y=new s(l.commonBase);a.exports.sendlog=function(e,t){setTimeout(function(){n(e,t)},0)}});
;define("disk-share:widget/system/util/logs/riskLabel.js",function(o,e,n){function i(o,e){if(e||(e={}),o){var n=a[o];n.ext=e,l.sendLog(n)}}var s=window.locals.get("is_knowledge")||0,t=o("base:widget/tools/tools.js"),a={commonBase:{serverId:18987,from:t.getParam("from",location.href)||"net_basics",page:"link_list_page",appname:"wangpan",source:s?"knowledge":"normal"},linkListIconDis:{type:"display",value:"link_list_icon_dis",comment:"隐藏icon展现"},iconHover:{type:"clk",value:"icon_hover",comment:"鼠标放在icon上，hover展现"}},c=window.BpData;c||(c=function(){},c.prototype.sendLog=function(){});var l=new c(a.commonBase);n.exports.send=function(o,e){setTimeout(function(){i(o,e)},0)}});
;define("disk-share:widget/pageModule/share-file-main/fileType/other.js",function(e){function i(e){return""===e?"":e.match(/([^\.]+)$/)[1].toLowerCase()}var n=e("system-core:context/context.js").instanceForSystem,o=e("base:widget/libs/jquerypacket.js"),a=e("base:widget/libs/underscore.js"),s=1048576,t=10*s,l={node:{fileInfo:'[node-type="share-info-box"]',unzipBox:"span.unzip-box",fileOpenBtn:'[node-type="info-open-button"]'},tmpl:{zip:['<a class="fileicon" node-type="info-open-button" href="javascript:;"></a>','<div class="share-info-zipdesc">',"文件大小:",'<span class="zip-quota"><%- info.fileQuota %></span>','<div class="unzip-box-bar"><span class="unzip-box" node-type="info-open-button"></span></div>',"</div>"].join(""),other:['<a class="fileicon" href="javascript:;" style="cursor: default;"></a>','<div class="share-info-zipdesc">',"文件大小:",'<span class="zip-quota"><%- info.fileQuota %></span>',"</div>"].join("")},classify:function(){var e=(n.list.getSelected()||[])[0]||{},o=i(e.server_filename);"zip"===o||"rar"===o?(e.fileType="zip",n.log.send({name:"web_link_share_preview_action",value:{value:"预览zip",category:8}}),l.excuteZip(e)):l.checkIsCode(o)?(e.fileType="code",l.excuteCode(e)):(e.fileType="other",l.renderStyle(e))},checkIsCode:function(e){if(!e)return!1;var i=a.find(window.manifest,function(e){return"网盘代码阅读器"===e.name});return i?i.filesType.indexOf(e)>-1:!1},excuteZip:function(e){l.renderStyle(e);var i={type:"big",color:"blue",title:"打开压缩包",resize:!0};n.ui.button(i).appendTo(o(l.node.unzipBox)),l.node.fileInfoNode.delegate(l.node.fileOpenBtn,"click",function(){n.message.callPlugin("网盘解压缩@com.baidu.pan",{filesList:[e]})})},excuteCode:function(e){var i=l.node.fileInfoNode=o(l.node.fileInfo);n.message.callPlugin("网盘代码阅读器@com.baidu.pan",{filesList:e,dom:i,onerror:function(){var e=['<div class="doc-view-failed">','<div class="doc-view-failed-img" style="display: block;">','<div class="doc-view-failed-txt">啊哦，预览不成功啊，下载下来看吧</div>',"</div>",'<div class="cb"></div>',"</div>"].join("");i.html(e)},limitTxtSize:t})},renderStyle:function(e){var i=n.tools.baseService.toFriendlyFileSize(e.size),s=n.file.getFileInfo(e.path,e.isdir,!1,!1,!0).largeIcon,t=a.template(l.tmpl[e.fileType],{variable:"info"})({fileQuota:i}),d=l.node.fileInfoNode=o(l.node.fileInfo);d.append(t).addClass("share-info-default").find(".fileicon").addClass(s)}};l.classify()});
;define("disk-share:widget/pageModule/share-file-main/fileType/document.js",function(e){var i=e("base:widget/libs/jquerypacket.js"),a=e("system-core:context/context.js").instanceForSystem,s=i('[node-type="share-info-box"]'),l=(a.list.getSelected()||[])[0]||{};a.log.send({name:"web_link_share_preview_action",value:{value:"外链分享页文档预览",category:4,subType:"preview"}}),a.message.callPlugin("网盘文档阅读器@com.baidu.pan",{filesList:l,dom:s,onerror:function(){a.log.send({name:"web_link_share_preview_action",value:{value:"外链分享页文档预览失败",category:4,subType:"fail"}});var e=['<div class="doc-view-failed">','<div class="doc-view-failed-img" style="display: block;">','<div class="doc-view-failed-txt">',"啊哦，预览不成功啊，下载下来看吧","</div>","</div>",'<div class="cb"></div>',"</div>"].join("");s.html(e)}})});
;define("disk-share:widget/pageModule/share-file-main/fileType/bt.js",function(e){var i=e("system-core:context/context.js").instanceForSystem,s=e("base:widget/libs/jquerypacket.js"),a=e("base:widget/libs/underscore.js"),t=a.template(['<a class="fileicon" node-type="info-open-button" href="javascript:;"></a>','<div class="share-info-zipdesc">',"文件大小:",'<span class="zip-quota"><%- info.fileQuota %></span>','<div class="bt-box-bar"><span class="bt-box" node-type="bt-open-button"></span></div>',"</div>"].join(""),{variable:"info"}),n=(i.list.getSelected()||[])[0]||{},o=i.tools.baseService.toFriendlyFileSize(n.size),l=i.file.getFileInfo(n.path,n.isdir,!1,!1,!0).largeIcon,d=t({fileQuota:o});s('[node-type="share-info-box"]').append(d).addClass("share-info-default").find(".fileicon").addClass(l)});
;define("disk-share:widget/pageModule/share-file-main/fileType/application.js",function(e){var i=e("system-core:context/context.js").instanceForSystem,s=e("base:widget/libs/jquerypacket.js"),a=e("base:widget/libs/underscore.js"),t=a.template(['<a class="fileicon" href="javascript:;" style="cursor: default;"></a>','<div class="share-info-zipdesc">',"文件大小:",'<span class="zip-quota"><%- info.fileQuota %></span>',"</div>"].join(""),{variable:"info"}),l=(i.list.getSelected()||[])[0]||{},o=i.tools.baseService.toFriendlyFileSize(l.size),n=i.file.getFileInfo(l.path,l.isdir,!1,!1,!0).largeIcon,d=t({fileQuota:o});s('[node-type="share-info-box"]').append(d).addClass("share-info-default").find(".fileicon").addClass(n)});
;define("disk-share:widget/pageModule/share-file-main/fileType/picture/picture.js",function(e){function t(e){var t=a(e.parentNode.parentNode);e.style.height="auto",e.style.width="auto";var i=e.naturalWidth||e.width,r=e.naturalHeight||e.height;if(i>t.width()||r>t.height()){var n=t.width()>t.height();n?e.style.height="100%":e.style.width="100%"}}var i=e("system-core:context/context.js").instanceForSystem,a=e("base:widget/libs/jquerypacket.js"),r=e("disk-share:widget/pageModule/share-file-main/fileType/picture/Rotater.js"),n={conf:{},q:{mod:".module-share-file-main",picFileDetail:".picture-file-detail",picContainer:".picContainer",rotateBar:".rotateBar"},init:function(e){var n=this,o=a(n.q.mod),s=function(){var e=document.getElementById("viewFailed");e.style.display="block",o.find(n.q.picFileDetail).css("background","#efefef"),o.find(n.q.picContainer).remove(),o.find(n.q.rotateBar).remove()};if(!e)return void s();var d=document.getElementById("rotateImage"),l=e.replace("c850_u580","c710_u400");d&&(d.onload=function(){t(d);var e="new_single_disk_share"!==window.SHARETYPE&&"new_multi_disk_share"!==window.SHARETYPE;a(".picture-file-detail").mouseenter(function(){e&&a(".rotateBar").show()}).mouseleave(function(){e&&a(".rotateBar").hide()}),r("#rotateContainer",".RotaterBtn"),i.log.send({type:"picpreview_successed_analyties",sendPageFrom:!0,from_uk:window.locals.get("share_uk")})},d.onerror=s,d.src=l)}},o=(i.list.getSelected()||[])[0]||{};n.init(o.thumbs.url3)});
;define("disk-share:widget/pageModule/share-file-main/fileType/music/music.js",function(e){var i=e("system-core:context/context.js").instanceForSystem;i.log.send({name:"web_link_share_preview_action",value:{value:"外链分享页音频播放",category:2}}),i.message.callPlugin("网盘音频播放器@com.baidu.pan",{filesList:window.locals.get("file_list"),inDialog:!1})});
;define("disk-share:widget/pageModule/share-file-main/fileType/video/video.js",function(e,i,a){var o=e("base:widget/libs/jquerypacket.js"),t=e("base:widget/vip/vip.js"),n=e("system-core:context/context.js").instanceForSystem,r=e("base:widget/storage/storage.js"),s=e("disk-share:widget/system/util/elinkThemeRender.js"),l=e("file-widget-1:videoPlay/utils/video-level.js"),d=n.message,c=(1===window.locals.get("loginstate"),"transfer_files_"+window.locals.get("uk")),v=e("disk-share:widget/system/util/log.js"),f=e("disk-share:widget/system/util/logs/pcInvoker.js"),p=window.locals.get("video_disk_share"),u={node:{container:"#video-wrap",mod:"#video-wrap-outer",startTip:".video-start-tip",replayBtn:".replay-btn",saveToPan:".save-to-pan",callClient:".video-call-client"},vars:{hasTransfered:!1,shareFileId:window.metaData.FS_ID+"@"+window.locals.get("uk")+",",previewTime:90,resolveFileInDiskStatus:0,isViewAllVideo:!1,videoLogParam:{}},callPlugin:function(){var e=(n.list.getSelected()||[])[0]||{},i=window.locals.get("file_list"),a={},r="";if(i&&i.length>0){for(var c=0;c<i.length;c++)if(i[c].fs_id===e.fs_id){a=i[c];break}r=i[0].server_filename+(i.length>1?"等":"")}u.vars.videoLogParam={user_type:2===t.getVipValue()?"svip":0===t.getVipValue()?"norm":"other",is_login:0!==e.uk?1:0,share_id:window.locals.get("shareid"),share_name:r,link_share_uk:window.locals.get("share_uk"),fsid:a.fs_id||e.fsid||"",md5:a.md5||"",file_name:a.server_filename||e.fileName||"",file_path:a.path||""},window.locals.get("sign","timestamp","share_uk","shareid","Elink_info","Espace_info",function(i,a,r,c,f,g){u.vars.isViewAllVideo=u.checkCertLinkStatus(f,g);var m={file:e,container:o(u.node.container),flag:"sharevideo",rememberPosition:!1,autoplay:p>=2?!1:!0,werbung:window.locals.get("self"),getUrl:function(o){return location.protocol+"//"+location.host+"/share/streaming?channel=chunlei&uk="+r+"&fid="+e.fs_id+"&sign="+i+"&timestamp="+a+"&shareid="+c+"&type="+o+"&vip="+t.getVipValue()+"&jsToken="+window.jsToken},callback:function(i){u.player=i,u.checkInDisk()||s.getTransferAndDownloadStatus(function(i){!i.cantTransfer&&!i.cantDownload&&e.duration>u.vars.previewTime&&(o(u.node.mod).find(".video-start-tip").show(),v.sendlog("tryPalyDis",u.vars.videoLogParam))}),1===f.isElink&&o(u.node.mod).find(".video-start-tip").hide()},onBeforePlay:function(){if(p>=2){var e=o(u.node.mod);return e.find(".video-overlay-iframe").show(),e.find(".video-start-btn-tip").show(),!1}return!0},onPlay:function(){p>=2&&u.player.pause(),n.log.send({name:"web_link_share_preview_action",value:{value:"外链分享页视频播放",category:1}})},onPause:function(){},onBeforeDestroy:function(){return!0},onTimeUpdate:function(e,i){u.checkNotOver(e,i)}},_={url:location.protocol+"//update.pan.baidu.com/statistics",type:"vast_player_user_number",op:"vast_player_user_number",isvip:t.getVipValue(),value:JSON.stringify({netdisk_user_number:{media_source:"801",file_md5:e.md5||"",media_from:"sharevideo"}})};v.sendlog("videoPlayerDis",u.vars.videoLogParam),l.getLevel("videopreview_share").then(function(e){m.useNewSDK=e.value,d.callPlugin("网盘视频播放器@com.baidu.pan",m),_.useNewSDK=m.useNewSDK,n.log.send(_)})})},checkNotOver:function(e){var i=u.vars||{};return i.hasTransfered||window.locals.get("self")?!0:i.isViewAllVideo?!0:void u.videoRunLimit(e)},videoRunLimit:function(e){if(e>u.vars.previewTime){var i=o(u.node.mod);u.player.pause(),i.find(".video-start-tip").hide(),i.find(".video-overlay-iframe").show(),s.getTransferAndDownloadStatus(function(e){e.cantTransfer||e.cantDownload||("none"===i.find(".video-over-tip").css("display")&&(v.sendlog("tryEndDis",u.vars.videoLogParam),"block"===i.find(".video-over-tip-wrap").css("display")&&f.send("webEvokedBtnDis",{page:"video_details",ext:{scene:"share_link",btn:"to_pc2"}})),i.find(".video-over-tip").show())})}},checkInDisk:function(){if(1!==+window.locals.get("loginstate"))return!1;if(window.locals.get("self"))return!0;var e=(n.list.getSelected()||[])[0]||{},i=JSON.parse(localStorage.getItem(c))||[];return-1!==i.indexOf(e.fs_id)?(u.vars.hasTransfered=!0,!0):!1},checkCertLinkStatus:function(e,i){if(e&&1===e.isElink&&i){var a=i.Espace_cert_status||0,o=i.Espace_op_status||0,t=i.Espace_product_status,n=i.Espace_product_type,r=0===a&&0===o,t=t,s=enterpriseProductBase.check("supportUnlimitedVideoPreview",{productType:n}),l=0===s.code&&s.value;return r&&0===t&&l}return!1},playError:function(e,i,a){var t=o(u.node.container);t.addClass("error-tips"),t.html('<div class="tip">'+(i?'<i class="tip-fail"></i>':"")+'<span class="tip-txt">'+e+(a?'&nbsp;&nbsp;&nbsp;&nbsp;<a href="javascript:void(0);">重试</a>':"")+"</span></div>"),a&&t.find("a").click(function(){u.callPlugin()})},events:function(){var e=o(u.node.mod);o("#layoutHeader").css({zIndex:41}),e.find(".video-start-tip").on("click",".close-btn",function(){e.find(".video-start-tip").hide(),v.sendlog("tryPalyCloseClk",u.vars.videoLogParam)}),e.find(".save-to-pan").on("click",function(e){var i=(n.list.getSelected()||[])[0]||{};d.trigger("plugin:保存到网盘@com.baidu.pan.share",{filesList:[i]}),u.rememberTreansfer(),e.target.classList.length>1?v.sendlog("tryEndSaveClk",u.vars.videoLogParam):v.sendlog("tryPalyClk",u.vars.videoLogParam)}),e.find(".save-back-to-pc-btn").on("click",function(){var e=(n.list.getSelected()||[])[0]||{};d.trigger("plugin:保存到网盘@com.baidu.pan.share",{filesList:[e],config:{name:"videoSavetoPc"}}),u.rememberTreansfer(),f.send("webVideoSaveEvokedClk")}),e.find(".back-to-pc-btn").on("click",function(){d.callPlugin("网盘外链-调端@com.baidu.pan",{type:"video_evoked"}),f.send("webVideoEvoked1Clk")}),e.find(".replay-btn").on("click",function(){e.find(".video-over-tip").hide(),e.find(".video-overlay-iframe").hide(),u.callPlugin(),v.sendlog("tryEndReplayClk",u.vars.videoLogParam)}),e.find(".video-call-client").on("click",function(){d.callPlugin("网盘外链-调端@com.baidu.pan",{btn:"to_pc2"})}),d.listen("share-video-after-transfer",function(){u.rememberTreansfer(),e.find(".video-start-tip").hide(),"block"===e.find(".video-overlay-iframe").css("display")&&2>p&&(e.find(".video-overlay-iframe").hide(),e.find(".video-over-tip").hide(),u.player&&u.player.play())})},rememberTreansfer:function(){var e=r.getItem("panTransferedFile");e=e?e:"",-1===e.indexOf(u.vars.shareFileId)&&r.setItem("panTransferedFile",e+u.vars.shareFileId);var i=(n.list.getSelected()||[])[0]||{},a=JSON.parse(localStorage.getItem(c))||[];-1!==a.indexOf(i.fs_id)&&(u.vars.hasTransfered=!0)}};u.events(),window.locals.get("file_list","shareid",function(e,i){e[0]&&i?u.callPlugin():(u.playError("文件不存在，加载失败",!0,!1),n.log.send({type:"web_video_play_error",isvip:t.getVipValue(),from:400001,flag:"sharevideo"}),n.log.send({url:location.protocol+"//update.pan.baidu.com/statistics",type:"vast_player_play_error",op:"vast_player_play_error",isvip:t.getVipValue(),value:JSON.stringify({netdisk_get_mdedia_info_play_error:{video_info:{media_source:"801",media_from:"sharevideo"},error_info:{player_error:{system_time:+new Date,error_code:400001}}}})}))}),a.exports=u});
;define('disk-share:widget/system/util/riskLabelUtil.js', function(require, exports, module){ var vipStatus = require('base:widget/vip/vip.js');
var util = require('disk-share:widget/system/util/util.js');
var riskLabelLog = require('disk-share:widget/system/util/logs/riskLabel.js');

var ua = navigator.userAgent;
var pathname = window.location.pathname;
var surl = pathname.split('/s/')[1];
var isThirdLink = pathname.indexOf('/link/') > -1;

module.exports = {
    getIsHasRiskFile: function () {
        var param = {
            uk: window.locals.get('share_uk'),
            share_id: window.locals.get('shareid'),
        }
        // 违规icon接口直接通过url获取pwd会不准
        var pwd = decodeURIComponent(localStorage.getItem(surl + '_pwd') || '');
        if(!isThirdLink && pwd && pwd.length > 0){
            param.pwd = pwd;
        }
        var self = this;
        $.ajax({
            type: 'post',
            url: '/share/risklabel' + '?' + $.param(param),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            success: function (res) {
                if (res && res.errno === 0) {
                    if (res.hit_risklabel === 0) {
                        self.startRiskLabelPolling(res.taskid);
                    } else {
                        self.showRiskFileIcon(res.hit_risklabel);
                    }
                }
            }
        });
    },
    startRiskLabelPolling: function (taskid) {
        var param = {
            uk: window.locals.get('share_uk'),
            share_id: window.locals.get('shareid'),
            taskid,
            scene: 'risk_label'
        }
        var pwd = decodeURIComponent(localStorage.getItem(surl + '_pwd') || '');
        if (pwd && pwd.length > 0) {
            param.pwd = pwd;
        }
        var self = this;
        $.ajax({
            type: 'post',
            url: '/share/taskquery' + '?' + $.param(param),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            success: function (res) {
                if (res && res.errno === 0) {
                    if (res.hit_risklabel === 0) {
                        setTimeout(function () {
                            self.startRiskLabelPolling(res.taskid);
                        }, 1000);
                    } else {
                        self.showRiskFileIcon(res.hit_risklabel);
                    }
                }
            }
        });
    },
    showRiskFileIcon: function (hit_risklabel) {
        if (hit_risklabel === 1) {
            $('.risk-label').css('display', 'block');
            var fileList = window.locals.get('file_list') || [];
            var logParams = this.getLogParams(fileList);
            riskLabelLog.send('linkListIconDis',{
                ext: logParams
            });
        }
    },
    getLogParams: function (fileList) {
        var shareName = fileList[0].server_filename + (fileList.length > 1 ? '等' : '');
        return {
            share_id: window.locals.get('shareid'),
            user_type: vipStatus.getVipValue(),
            opera_client: 'web',
            share_name: shareName,
            md5: fileList[0].md5,
            is_login: window.locals.get('loginstate'),
            plat: this.getBrowserType()
        }
    },
    getBrowserType: function () {
        let type = '';
       if (ua.indexOf('MSIE') > -1 || ua.indexOf('Trident') > -1) {
            type = 'IE';
        } else if (ua.indexOf('Edge') > -1 ||
            ua.indexOf('Edg/') > -1 ||
            ua.indexOf('EdgA') > -1 ||
            ua.indexOf('EdgiOS') > -1) {
            type = 'Edge';
        } else if (ua.indexOf('Firefox') > -1 || ua.indexOf('FxiOS') > -1) {
            type = 'Firefox'
        } else if (ua.indexOf('YaBrowser') > -1) {
            type = 'Yandex';
        } else if (ua.indexOf('QihooBrowser') > -1 || ua.indexOf('QHBrowser') > -1) {
            type = "360";
        } else if (ua.indexOf('360EE') > -1) {
            type = "360EE";
        } else if (ua.indexOf('360SE') > -1) {
            type = "360SE";
        } else if (ua.indexOf('UCBrowser') > -1 ||
            ua.indexOf(' UBrowser') > -1 ||
            ua.indexOf('UCWEB') > -1) {
            type = "UC";
        } else if (ua.indexOf('QQBrowser') > -1) {
            type = "QQBrowser";
        } else if (ua.indexOf('QQ/') > -1) {
            type = "QQ";
        } else if (ua.indexOf('Baidu') > -1 ||
            ua.indexOf('BIDUBrowser') > -1 ||
            ua.indexOf('baidubrowser') > -1 ||
            ua.indexOf('baiduboxapp') > -1 ||
            ua.indexOf('BaiduHD') > -1) {
            type = "Baidu";
        } else if (ua.indexOf('MetaSr') > -1 || ua.indexOf('Sogou') > -1) {
            type = "Sogou";
        } else if (ua.indexOf('LBBROWSER') > -1 || ua.indexOf('LieBaoFast') > -1) {
            type = "Liebao";
        } else if (ua.indexOf('MiuiBrowser') > -1) {
            type = "XiaoMi";
        } else if (ua.indexOf('Quark') > -1) {
            type = "Quark";
        } else if (ua.indexOf('HuaweiBrowser') > -1 ||
            ua.indexOf('HUAWEI/') > -1 ||
            ua.indexOf('HONOR') > -1) {
            type = "Huawei";
        } else if (ua.indexOf('Chrome') > -1 || ua.indexOf('CriOS') > -1) {
            type = 'Chrome';
        } else if (ua.indexOf('Safari') > -1) {
            type = 'Safari';
        } else {
            type = 'other';
        }
        return type;
    }
} 
});
;define("disk-share:widget/pageModule/share-header/share-im/share-im.js",function(e,o,i){var t=e("base:widget/libs/underscore.js"),n=e("base:widget/libs/jquerypacket.js"),s=e("system-core:context/context.js").instanceForSystem,a=e("disk-share:widget/system/util/logs/im.js"),r=location.pathname.indexOf("/link/")>-1||/(\?|&)linksource=/.test(location.search),u="share_im_auto_join_group",d=["<% _.each(buttons, function (item) { %>",'   <div class="share-im-button <%- item.className %>" data-id="<%- item.gid %>">','       <div class="share-im-button__content">','           <div class="share-im-button__icon"></div>','           <div class="share-im-button__text"><%- item.name %></div>',"       </div>",'       <div class="share-im-button__join"><%- item.joinText %></div>',"       </div>","<% }); %>"].join(""),c='<div class="share-group-container__divider"></div><div class="share-group-container__buttons">'+d+"</div>",l={targets:[],mboxInfo:[],toLogin:function(){window.yunHeader.login.util.loginNew()},addTargets:function(e){t.find(l.targets,function(o){return o===e})||l.targets.push(e)},toIm:function(e){var o=n.param({fromId:locals.get("uk"),toId:e,covType:"groupCov"}),i="https://pan.baidu.com/disk/main#/im/session?"+o;window.open(i)},getMountsInfo:function(){return l.mboxInfo.length?Promise.resolve(l.mboxInfo):new Promise(function(e){n.ajax({type:"post",url:"/share/mountsinfo?time=1&rand=1&version=1",data:{share_uk:window.locals.get("share_uk"),share_id:window.locals.get("shareid")},headers:{"Content-Type":"application/x-www-form-urlencoded"},success:function(o){var i=[],t=0;if(o&&0===o.errno)for(var s=o.mbox_info||[],a=0;a<s.length;a++){var r=s[a];if(!r.banflag){var u=!!r.inside,d=n.extend({className:u?"joined":"",joinText:u?"去看看":"加入"},r);r.member_count>=r.maximum?i.push(d):(i.splice(t,0,d),t++)}}l.mboxInfo=i,e(i)},error:function(){e([])}})})},createButtons:function(e){var o=e.buttons,i=e.$el;if(o.length){o.length>3&&(o=o.slice(0,3));var s=t.template(d)({buttons:o}),r=n(s);i.on("click",".share-im-button",function(){var e=n(this),o=e.data("id");return e.hasClass("joined")?(l.toIm(o),void a.sendLog("viewGroupClick")):(l.handleJoinGroup(o,i),void a.sendLog("joinGroupClick"))}),i.append(r),i.css("display","flex"),n(window).trigger("resize"),l.addTargets(i)}},createDialogButtons:function(e){var o=e.buttons,i=o.length;if(i){i>2&&(o=o.slice(0,2));var s=t.template(c)({buttons:o}),r=n(s);e.$el.addClass("share-group-section"),e.$el.on("click",".share-im-button",function(){var o=n(this),i=o.data("id");return o.hasClass("joined")?(l.toIm(i),void a.sendLog("viewGroupClick")):(l.handleJoinGroup(i,e.$el),void a.sendLog("saveJoinGroupClick"))}),e.$el.append(r),l.addTargets(e.$el)}},handleJoinGroup:function(e,o){if(1!==window.locals.get("loginstate"))return sessionStorage.setItem(u,""+e),void l.toLogin();var i=t.find(l.mboxInfo,function(o){return o.gid===e});return i=i||{},i.inside?(l.toIm(e),void a.sendLog("viewGroupClick")):void l.joinGroup({gid:e,invite_uk:i.inviteUk,invite_time:i.invite_time,sign:i.sign,prejoin:0,source:5},function(){i.inside=1,i.joinText="去看看",i.className="joined",l.addTargets(o),t.each(l.targets,function(o){var i=o.find('.share-im-button[data-id="'+e+'"]');i.addClass("joined"),i.find(".share-im-button__join").text("去看看")})})},joinGroup:function(e,o){n.ajax({type:"post",url:"/mbox/group/join",data:e,headers:{"Content-Type":"application/x-www-form-urlencoded"},success:function(i){var t=i&&i.errno;if(0===t||2100===t){var r=n.param({fromId:locals.get("uk"),toId:e.gid,covType:"groupCov"}),u="https://pan.baidu.com/disk/main#/im/session?"+r,d=s.ui.tip({mode:"success",msg:'已加入该群<a class="tip-msg-btn" href="javascript:void(0)">去看看</a>',className:"share-toast",autoClose:!1,sticky:!1});d.$ele.find(".tip-msg-btn").on("click",function(){a.sendLog("viewGroupClick"),window.open(u)}),d.$ele.css({"margin-left":d.$ele.innerWidth()/-2+"px"}),setTimeout(function(){d.hide()},5e3),o&&o()}else if(2119===t){var d=s.ui.tip({mode:"none",msg:"群人满啦，下次来早点哦～",className:"share-toast",autoClose:!1,sticky:!1});setTimeout(function(){d.hide()},5e3),a.sendLog("groupFullNoticeExposure")}else s.ui.tip({msg:"加群失败，请稍后再试～",className:"share-toast",sticky:!1})},error:function(){s.ui.tip({msg:"加群失败，请稍后再试～",className:"share-toast",sticky:!1})}})}},m={isShowImGroupList:function(){return r?Promise.resolve(!1):l.getMountsInfo().then(function(e){return e.length>0})},init:function(){m.isShowImGroupList().then(function(e){e&&(a.sendLog("groupLinkDisplay"),window.yunHeader.on("passportDialogHide",function(){sessionStorage.removeItem(u)}),l.getMountsInfo().then(function(e){l.createButtons({$el:n(".slide-show-im"),buttons:e});var o=sessionStorage.getItem(u);o&&(l.handleJoinGroup(o,n(".slide-show-im")),sessionStorage.removeItem(u))}))})},createDialogButtons:function(){m.isShowImGroupList().then(function(e){e&&(a.sendLog("saveGroupDisplay"),l.getMountsInfo().then(function(e){l.createDialogButtons({$el:n(".share-group-container"),buttons:e})}))})}};i.exports=m});
;define('disk-share:widget/pageModule/share-header/back-client-motivation.js', function(require, exports, module){ /**
 * 外链回端激励
 */

var context = require('system-core:context/context.js').instanceForSystem;
var BpABTest = require('disk-share:widget/system/util/ab.js');

var pri = {
    callClientBtnSelector: '.new-disk-call-client'
};

// 命中实验的处理
function handleHitExperiment() {
    var callClientBtn = $(pri.callClientBtnSelector);

    // 创建徽标
    callClientBtn.append(
        '<img src="https://staticsns.cdn.bcebos.com/amis/2025-9/1756822572307/50g2x.png" class="new-disk-call-client-img"></img>'
    );
    // 绑定事件
    callClientBtn.on('click', function () {
        requestIncentiveMark();
    });
}

function requestIncentiveMark() {
    $.ajax({
        url: '/api/incentive/mark',
        type: 'get',
        dataType: 'json',
        data: {
            clienttype: 0
        },
        success: function (res) {
            if (!res || res.errno !== 0) {
                context.ui.tip({
                    mode: 'caution',
                    msg: '请求失败，请稍后再试',
                    sticky: false
                });
            }
        },
        error() {
            context.ui.tip({
                mode: 'caution',
                msg: '请求失败，请稍后再试',
                sticky: false
            });
        }
    });
}

/**
* 请求激励识别
*
* @returns 返回一个 Promise 对象，该对象在成功解析时返回一个对象，其中包含属性 isTarget，表示是否为目标用户
*/
function requestIncentiveIdentify() {
    if (requestIncentiveIdentify.p) {
        return requestIncentiveIdentify.p;
    }

    requestIncentiveIdentify.p = new Promise(function (resolve) {
        $.ajax({
            url: '/api/incentive/identify',
            type: 'get',
            dataType: 'json',
            data: {
                clienttype: 0
            },
            success: function (res) {
                if (!res || res.errno !== 0) {
                    resolve({ isTarget: false });
                    return;
                }

                var isTarget = res.data ? res.data.is_target : false;

                resolve({ isTarget: isTarget });
            },
            error: function () {
                resolve({ isTarget: false });
            }
        });
    });

    return requestIncentiveIdentify.p;
}

/**
* 请求激励实验
*
* @returns {Promise<{hit: boolean}>} 返回一个Promise对象，Promise解析后返回的对象包含一个布尔值属性hit，表示是否命中实验
*/
function requestIncentiveExperiment() {
    if (requestIncentiveExperiment.p) {
        return requestIncentiveExperiment.p;
    }

    requestIncentiveExperiment.p = Promise.resolve({
        hit: true
    });

    return requestIncentiveExperiment.p;
}

function identifyIsTargetUser() {
    return requestIncentiveExperiment().then(function (experimentRes) {
        if (!experimentRes.hit) {
            return false;
        }

        return requestIncentiveIdentify().then(function (identifyRes) {
            return identifyRes.isTarget;
        });
    });
}

var pub = {
    identifyIsTargetUser: identifyIsTargetUser,
    requestIncentiveMark: requestIncentiveMark,
    init() {
        identifyIsTargetUser().then(function (isTarget) {
            if (isTarget) {
                handleHitExperiment();
            }
        });
    }
};

module.exports = pub;
 
});
;define("disk-share:widget/pageModule/share-person-info/service/adPanLog.js",function(e){var n=e("base:widget/libs/jquerypacket.js"),i=e("system-core:context/context.js").instanceForSystem,a={isOnIframe:!1,type:"",log:{view:function(e){n(window).load(function(){i.log.send({name:"sharePage_AD_plan_"+e+"_show"})})},click:function(e,o){e.find("iframe").hover(function(){a.isOnIframe=!0},function(){a.isOnIframe=!1}),n(window).blur(function(){a.isOnIframe&&i.log.send({name:"sharePage_AD_plan_"+o+"_click"})})},adClick:function(e,n){e.on("click",function(){i.log.send({name:"sharePage_AD_plan_"+n+"_click"})})}}},o=function(){var e=n("#share-ad-box"),i=n('.ad-multi-tips[node-type="share-mutil-bottom"]'),o=e.attr("type")||4,t=i.attr("type")||"";a.log.view(o),a.log.view(t),a.log.click(e,o),a.log.adClick(i,t)};o()});
;define("disk-share:widget/system/util/logs/im.js",function(e,o,i){function n(e,o){if(o||(o={}),e){var i=t[e];i.ext=o,s.sendLog(i)}}var t={commonBase:{serverId:19005,from:"net_basics",page:"netdisk_share",parasitifer:"web"},groupLinkDisplay:{type:"display",value:"group_link_exposure",comment:"web列表页群入口曝光"},saveGroupDisplay:{type:"display",value:"save_group_link_exposure",comment:"web转存页群入口曝光"},joinGroupClick:{type:"click",value:"list_join_group",comment:"在外链列表页用户点击【加入群】"},viewGroupClick:{type:"click",value:"view_group",comment:"加入成功后，用户点击【去查看群】"},groupFullNoticeExposure:{type:"click",value:"group_full_notice_exposure",comment:"【群已满】提示曝光"},saveJoinGroupClick:{type:"click",value:"save_join_group",comment:"在转存弹窗用户点击【加入群】"}},p=window.BpData;p||(p=function(){},p.prototype.sendLog=function(){});var s=new p(t.commonBase);i.exports.sendLog=function(e,o){setTimeout(function(){n(e,o)},0)}});
;define("disk-share:widget/system/util/logs/knowledge.js",function(e,o,n){function l(e,o){if(o||(o={}),e){var n=a[e];n.ext=o,m.sendLog(n)}}var i=window.locals.get("is_knowledge")||0,t=e("base:widget/tools/tools.js"),a={commonBase:{serverId:19005,from:t.getParam("from",location.href)||"net_basics",page:"link_list_page",parasitifer:"web",appname:"wangpan",source:i?"knowledge":"normal"},DialogWindowDis:{type:"display",value:"DialogWindowDis",comment:"对话窗口展示"},SubsFolderDis:{type:"display",value:"SubsFolderDis",comment:"订阅文件夹按钮展示"},JoinedFolderDis:{type:"display",value:"JoinedFolderDis",comment:"已加入按钮展示"},DialogWindowClk:{type:"clk",value:"DialogWindowClk",comment:"用户对话窗口点击"},SubsFolderClk:{type:"clk",value:"SubsFolderClk",comment:"订阅文件夹点击"},RemoveConfPopupClk:{type:"clk",value:"RemoveConfPopupClk",comment:"取消订阅文件夹点击"},con_RemoveConfClk:{type:"clk",value:"con_RemoveConfClk",comment:"取消订阅文件夹确认点击"},uncon_RemoveConfClk:{type:"clk",value:"uncon_RemoveConfClk",comment:"取消订阅文件夹取消点击"}},s=window.BpData;s||(s=function(){},s.prototype.sendLog=function(){});var m=new s(a.commonBase);n.exports.send=function(e,o){setTimeout(function(){l(e,o)},0)}});
;define('disk-share:widget/pageModule/share-header/join-folder.js', function(require, exports, module){ /**
 * @file 加入文件夹
 * @author: dongwanhong@baidu.com
 */

var $ = require('base:widget/libs/jquerypacket.js');
var tools = require('base:widget/tools/tools.js');
var util = require('disk-share:widget/system/util/util.js');
var context = require('system-core:context/context.js').instanceForSystem;
var knowledgeLog = require('disk-share:widget/system/util/logs/knowledge.js');

var MESSAGE_EVENTS = {
    SUBSCRIBE_STATUS_CHANGE: 'join-folder:subscribe-status-change'
};

var Message = context.message;
var surl = window.location.pathname.split('/s/')[1] || '';
var surlKey = surl.replace(/^5/, '');
var fileList = window.locals.get('file_list') || [];
var fileMeta = fileList[0] || {};
var fileName = tools.toEntity(fileMeta.server_filename);
var dialog;

var pri = {
    conf: {
        hasJoined: false,
        subFolderUrl: 'https://pan.baidu.com/disk/main#/knowledgesub?category=all&path=%2F%E5%B7%B2%E8%AE%A2%E9%98%85%E6%96%87%E4%BB%B6%E5%A4%B9'
    },
    api: {
        queryJoinApi: '/knowledge/sub/exist',
        joinActApi: '/knowledge/sub/act'
    },
    util: {
        // 跳转登录
        toLogin: function () {
            window.yunHeader.login.util.loginNew();
        },
        // 修改加入按钮
        changeJoinBtn: function (dom, text) {
            // bca-disable-line
            $(dom).html(text);
        },
        // 当加入文件夹后
        onJoined: function() {
            pri.conf.hasJoined = true;
            pri.util.changeJoinBtn(
                '.join-btn',
                '<em class="icon noicon pdr3px noicon-done"></em>已订阅<div class="join-btn-tip"></div>'
            );
            $('.join-btn').removeClass('no-joined');
            // bca-disable-line
            $('.join-btn-tip').html('可在我的网盘「<a class="join-btn-tip_link" target="_blank" href="' + pri.conf.subFolderUrl + '">已订阅文件夹</a>」查看');
            $('.join-btn-tip').show();
            $('.join-btn-tip').on('click', function (e){
                e.stopPropagation();
            });
            Message.trigger(MESSAGE_EVENTS.SUBSCRIBE_STATUS_CHANGE, { joined: true });
            knowledgeLog.send('JoinedFolderDis');
        },
        // 当取消加入文件夹后
        onCancelJoined: function () {
            pri.conf.hasJoined = false;
            pri.util.changeJoinBtn(
                '.join-btn',
                '<em class="icon noicon pdr3px noicon-join"></em>订阅文件夹<div class="join-btn-tip"></div>'
            );
            $('.join-btn').addClass('no-joined');
            $('.join-btn-tip').text('不占用个人空间，文件内容实时更新').show();
            $('.join-btn-tip').on('click', function (e){
                e.stopPropagation();
            });
            Message.trigger(MESSAGE_EVENTS.SUBSCRIBE_STATUS_CHANGE, { joined: false });
            knowledgeLog.send('SubsFolderDis');
        },
        // 加入引导
        autoShowJoinTips: function () {
            var hasShowJoinTips = localStorage.getItem('has_join') || false;

            if (hasShowJoinTips || pri.conf.hasJoined) {
                return;
            }

            $('.join-btn-tip').text('订阅文件夹后可实时看到文件更新').show();
            localStorage.setItem('has_join', true);
            setTimeout(function () {
                $('.join-btn-tip').hide();
            }, 5000);
        },
        // 加入成功引导
        autoShowJoinSuccessTips: function () {
            var hasShowJoinSuccessTips = localStorage.getItem('has_join_success') || false;

            if (hasShowJoinSuccessTips) {
                return;
            }

            $('.join-btn-tip').text('订阅成功，后续可以在“我的网盘/已订阅文件夹”查看').show();
            localStorage.setItem('has_join_success', true);
            setTimeout(function () {
                $('.join-btn-tip').hide();
            }, 5000);
        },
        // 加入文件夹
        joinFolder: function () {
            var tip = context.ui.tip({
                mode: 'loading',
                msg: '订阅中...'
            });
            window.locals.get('share_uk', function (shareUk) {
                $.ajax({
                    type: 'post',
                    url: pri.api.joinActApi,
                    data: {
                        surl: surlKey,
                        share_uk: shareUk,
                        op: 0 // 0-订阅, 1-取消订阅
                    },
                    dataType: 'json',
                    timeout: 100000,
                    success: function (res) {
                        if (res && res.errno === 0) {
                            tip.hide();
                            pri.util.onJoined();
                            // pri.util.autoShowJoinSuccessTips();
                        } else if (res && res.errno === -6) {
                            tip.hide();
                            pri.util.toLogin();
                        } else {
                            context.ui.tip({
                                mode: 'caution',
                                msg: '订阅失败，请稍后再试',
                                sticky: false
                            });
                        }
                    },
                    error: function () {
                        context.ui.tip({
                            mode: 'caution',
                            msg: '订阅失败，请稍后再试',
                            sticky: false
                        });
                    }
                });
            });
            knowledgeLog.send('SubsFolderClk');
        },
        // 取消加入文件夹
        cancelJoin: function () {
            context.ui.tip({
                mode: 'loading',
                msg: '取消订阅中...'
            });
            window.locals.get('share_uk', function (shareUk) {
                $.ajax({
                    type: 'post',
                    url: pri.api.joinActApi,
                    data: {
                        surl: surlKey,
                        share_uk: shareUk,
                        op: 1 // 0-订阅, 1-取消订阅
                    },
                    dataType: 'json',
                    timeout: 100000,
                    success: function (res) {
                        if (res && res.errno === 0) {
                            pri.util.onCancelJoined();
                            context.ui.tip({
                                mode: 'success',
                                msg: '取消订阅成功',
                                sticky: false
                            });
                        } else {
                            context.ui.tip({
                                mode: 'caution',
                                msg: '取消订阅失败，请稍后再试',
                                sticky: false
                            });
                        }
                    },
                    error: function () {
                        context.ui.tip({
                            mode: 'caution',
                            msg: '取消订阅失败，请稍后再试',
                            sticky: false
                        });
                    }
                });
            });
            knowledgeLog.send('RemoveConfPopupClk');
        },
        // 取消加入弹窗
        initCancelDialog: function () {
            var config = {
                title: '提示',
                className: 'cancel-join',
                body: '<div class="cancel-join-content">'
                    + '继续将会从订阅的文件夹列表中移除'
                    + '<div class="cancel-join-title">「' + fileName + '」</div>'
                    + '</div>',
                draggable: false,
                width: '480px',
                position: {
                    xy: 'center'
                },
                buttons: [
                    {
                        name: 'cancel',
                        title: '取消',
                        type: 'big',
                        position: 'center',
                        padding: [50, 50],
                        click: function () {
                            dialog.hide();
                            knowledgeLog.send('uncon_RemoveConfClk');
                        }
                    },
                    {
                        name: 'confirm',
                        title: '继续',
                        type: 'big',
                        color: 'blue',
                        position: 'center',
                        padding: [50, 50],
                        click: function () {
                            dialog.hide();
                            pri.util.cancelJoin();
                            knowledgeLog.send('con_RemoveConfClk');
                        }
                    }
                ]
            };
            dialog = context.ui.window(config);
        },
        // 注册加入文件夹点击事件
        registerJoinClick: function () {
            $('.join-btn').click(function () {
                locals.get('loginstate', function (isLogin) {
                    if (isLogin === 0) {
                        pri.util.toLogin();
                        return;
                    }
                    if (pri.conf.hasJoined) {
                        // 取消加入文件夹二次确认弹窗
                        pri.util.initCancelDialog();
                        dialog.show();
                    } else {
                        // 加入文件夹
                        pri.util.joinFolder();
                    }
                });
            });
        },
        // 注册鼠标 Hover 事件
        registerJoinBtnHover: function () {
            $('.join-btn').hover(
                function () {
                    if (pri.conf.hasJoined) {
                        $('.join-btn-tip').text('订阅成功，后续可以在“我的网盘/已订阅文件夹”查看').show();
                    } else {
                        $('.join-btn-tip').text('订阅文件夹，可实时查看文件更新').show();
                    }
                },
                function () {
                    $('.join-btn-tip').hide();
                }
            );
        },
        // 获取加入状态
        queryJoinInfo() {
            window.locals.get('Elink_info', 'share_uk', 'uk', function (elinkInfo, shareUk, uk) {
                var isElink = elinkInfo.isElink === 1;
                var autoJoin = util.getSearch('auto_join');
    
                // 企业外链&&主态外链不展示
                if (shareUk === uk || isElink) {
                    return;
                }
    
                $.ajax({
                    type: 'post',
                    url: pri.api.queryJoinApi + '?' + $.param({
                        query_type: 1,
                        share_uk: shareUk,
                        surl: surlKey
                    }),
                    data: {},
                    dataType: 'json',
                    timeout: 100000,
                    success: function (res) {
                        var exist = false;

                        if (res && res.errno === 0) {
                            try {
                                if (res.data && res.data.exist) {
                                    pri.util.onJoined();
                                    exist = true;
                                } else {
                                    pri.util.onCancelJoined();
                                    // pri.util.autoShowJoinTips();
                                }
                            } catch (error) {
                                console.log(error);
                            }
                        }
                        if (autoJoin && !exist) {
                            window.locals.get('loginstate', function (isLogin) {
                                if (isLogin === 0) {
                                    window.yunHeader.login.util.loginNew();
                                } else {
                                    pri.util.joinFolder();
                                }
                            });
                        }
                    },
                    error: function() {
                        pri.util.onCancelJoined();

                        if (autoJoin) {
                            window.locals.get('loginstate', function (isLogin) {
                                if (isLogin === 0) {
                                    window.yunHeader.login.util.loginNew();
                                }
                            });
                        }
                    },
                    complete: function() {
                        $('.join-btn').show();
                        $('.join-btn-tip').show();
                        pri.util.registerJoinClick();
                        // pri.util.registerJoinBtnHover();
                    }
                });
            });
        },
        // 处理工具栏按钮结构和样式
        justifyToolbar: function () {
            $('.knowledge-bar .tools-share-V20-btn:first-of-type').removeClass('hassep').addClass('first_btn');
            $('.knowledge-bar .tools-share-V20-btn:last-of-type').removeClass('save_btn').addClass('last_btn hassep');
        }
    },
    init: function () {
        pri.util.queryJoinInfo();
        setTimeout(function () {
            pri.util.justifyToolbar();
        }, 4);
    }
};

module.exports = pri;
 
});
;define('disk-share:widget/pageModule/share-header/subscribe-outside-link.js', function(require, exports, module){ /**
 * @file 外链订阅
 * @author: chenchubo@baidu.com
 */

var $ = require('base:widget/libs/jquerypacket.js');
var context = require('system-core:context/context.js').instanceForSystem;

var dialog;
var notThirdLink = window.location.pathname.indexOf('/link/') === -1;
var pri = {
    conf: {
        shortUrlData: '',
        hasSubscribed: false
    },
    api: {
        querySubscribApi: '/share/subscribe?method=query',
        addSubscribeApi: '/share/subscribe?method=add',
        cancelSubscribeApi: '/share/subscribe?method=cancel'
    },
    util: {
        getAutoSubStatus: function () {
            var nodeKey = 'sharelink_wap_config';
            var configKey = "sharelink_auto_sub_config";
            try {
                $.ajax({
                    url: '/api/getsyscfg',
                    type: 'get',
                    dataType: 'json',
                    data: {
                        cfg_category_keys: JSON.stringify([{
                            'cfg_category_key': nodeKey,
                            'cfg_version': 0
                        }]),
                        clienttype: 0,
                        version: '1.0.0'
                    },
                    success: function (res) {
                        if (!res || res.errno !== 0 || !res.sharelink_wap_config) {
                            return;
                        }
                        var cfglist = res.sharelink_wap_config.cfg_list;
                        if (!cfglist || !cfglist.length) {
                            return;
                        }
                        for (var i = 0; i < cfglist.length; i++) {
                            var fileInfo = cfglist[i];
                            if (fileInfo && fileInfo.node_key === configKey && fileInfo.sharelink_auto_sub_smallow_config) {
                                window.locals.set('trans_auto_sub_status', fileInfo.sharelink_auto_sub_smallow_config);
                            }
                        }
                    }
                });
            } catch (error) {
                console.log(error);
            }
        },
        getSekey: function () {
            var sPath = window.location.pathname.split('/s/');
            var result = '';
            if (sPath.length > 1) {
                var sekey = localStorage.getItem(sPath[1] + '_bdclnd') || '';
                if (sekey) {
                    result = sekey;
                }
            }
            return result;
        },
        // 查询订阅外链状态
        querySubscribInfo: function () {
            window.locals.get('Elink_info', 'shareid', 'share_uk', 'uk', function (elinkInfo, shareid, shareUk, uk) {
                var isElink = elinkInfo.isElink === 1;
                // 企业外链&&主态外链不展示
                if (shareUk === uk || isElink) {
                    return;
                }
                pri.conf.shortUrlData = '[{\"uk\":' + shareUk + ',' + '\"share_id\":' + shareid + '}]';
                $.ajax({
                    type: 'post',
                    url: pri.api.querySubscribApi,
                    data: {
                        list: pri.conf.shortUrlData
                    },
                    dataType: 'json',
                    timeout: 100000,
                    success: function (res) {
                        if (res && res.errno === 0) {
                            try {
                                if (res.data.list
                                    && res.data.list.length
                                    && res.data.list[0].status === 0
                                ) {
                                    pri.util.changeSubscribeBtn(
                                        '.subscribe-btn',
                                        '<em class="icon noicon pdr3px noicon-yidingyue" title="已订阅"></em>已订阅',
                                        true,
                                        {
                                            background: 'transparent',
                                            border: '1px solid #C3EAFF',
                                            color: '#06A7FF'
                                        }
                                    );
                                    context.log.send({
                                        type: 'subscribed_display',
                                        value: '已订阅按钮展现'
                                    });
                                } else {
                                    var orderText = '订阅链接';
                                    var fileList = window.locals.get('file_list') || [];
                                    if((window.SHARETYPE ==='new_single_disk_share' || window.SHARETYPE ==='new_multi_disk_share') && notThirdLink){
                                        orderText = '订阅';
                                    }
                                    pri.util.changeSubscribeBtn(
                                        '.subscribe-btn',
                                        `<em class="icon noicon pdr3px noicon-dingyue" title=${orderText}></em>${orderText}`,
                                        false,
                                        {
                                            background: '#06A7FF',
                                            color: '#FFFFFF'
                                        }
                                    );
                                    context.log.send({
                                        type: 'subscribe_display',
                                        value: '订阅按钮展现'
                                    });
                                }
                            } catch (error) {
                                console.log(error);
                            }
                        }
                        $('.subscribe-btn').show();
                        pri.util.handleSubscribeClick();
                        pri.util.subscribeTipsShow();
                    }
                });
            });
        },
        // 订阅
        addSubscribe: function () {
            context.log.send({
                type: 'subscribe_clk',
                value: '订阅按钮点击'
            });
            var tip = context.ui.tip({
                mode: 'loading',
                msg: '订阅中...'
            });
            $.ajax({
                type: 'post',
                url: pri.api.addSubscribeApi,
                data: {
                    list: pri.conf.shortUrlData
                },
                dataType: 'json',
                timeout: 100000,
                success: function (res) {
                    if (res && res.errno === 0
                        && res.data && res.data.length
                        && res.data[0].result === 0
                    ) {
                        pri.util.changeSubscribeBtn(
                            '.subscribe-btn',
                            '<em class="icon noicon pdr3px noicon-yidingyue" title="已订阅"></em>已订阅',
                            true,
                            {
                                background: 'transparent',
                                border: '1px solid #C3EAFF',
                                color: '#06A7FF'
                            }
                        );
                        tip.hide();
                        pri.util.initSuccessDialog();
                        dialog.show();
                        context.log.send({
                            type: 'subscribed_display',
                            value: '已订阅按钮展现'
                        });
                        context.log.send({
                            type: 'tc_succeed_display',
                            value: '订阅成功弹窗展现'
                        });
                    } else if (res && res.errno === -6) {
                        tip.hide();
                        pri.util.toLogin();
                    } else {
                        context.ui.tip({
                            mode: 'caution',
                            msg: '订阅失败，请稍后再试',
                            sticky: false
                        });
                    }
                },
                error: function () {
                    context.ui.tip({
                        mode: 'caution',
                        msg: '订阅失败，请稍后再试',
                        sticky: false
                    });
                }
            });
        },
        // 取消订阅
        cancelSubscribe: function () {
            context.ui.tip({
                mode: 'loading',
                msg: '取消订阅中...'
            });
            $.ajax({
                type: 'post',
                url: pri.api.cancelSubscribeApi,
                data: {
                    list: pri.conf.shortUrlData
                },
                dataType: 'json',
                timeout: 100000,
                success: function (res) {
                    if (res && res.errno === 0
                        && res.data && res.data.length
                        && res.data[0].result === 0
                    ) {
                        var orderText = '订阅链接';
                        var fileList = window.locals.get('file_list') || [];
                        if((window.SHARETYPE ==='new_single_disk_share' || window.SHARETYPE ==='new_multi_disk_share') && notThirdLink){
                            orderText = '订阅';
                        }
                        pri.util.changeSubscribeBtn(
                            '.subscribe-btn',
                            `<em class="icon noicon pdr3px noicon-dingyue" title="订阅"></em>${orderText}`,
                            false,
                            {
                                background: '#06A7FF',
                                color: '#FFFFFF'
                            }
                        );
                        context.ui.tip({
                            mode: 'success',
                            msg: '取消订阅成功',
                            sticky: false
                        });
                        context.log.send({
                            type: 'subscribe_display',
                            value: '订阅按钮展现'
                        });
                    } else {
                        context.ui.tip({
                            mode: 'caution',
                            msg: '取消订阅失败，请稍后再试',
                            sticky: false
                        });
                    }
                },
                error: function () {
                    context.ui.tip({
                        mode: 'caution',
                        msg: '取消订阅失败，请稍后再试',
                        sticky: false
                    });
                }
            });
        },
        handleSubscribeClick: function () {
            $('.subscribe-btn').click(function () {
                locals.get('loginstate', function (isLogin) {
                    if (isLogin === 0) {
                        pri.util.toLogin();
                        return;
                    }
                    if (pri.conf.hasSubscribed) {
                        pri.util.initCancelDialog();
                        dialog.show();
                        context.log.send({
                            type: 'subscribed_clk',
                            value: '已订阅按钮点击'
                        });
                        context.log.send({
                            type: 'tc_cancel_display',
                            value: '取消订阅弹窗展现'
                        });
                    } else {
                        pri.util.addSubscribe();
                    }
                });
            });
        },
        toLogin: function () {
            window.yunHeader.login.util.loginNew();
        },
        changeSubscribeBtn: function (dom, text, hasSubscribed, cssMap) {
            // bca-disable-line
            $(dom).html(text);
            // $(dom).css(cssMap);
            pri.conf.hasSubscribed = hasSubscribed;
        },
        // 订阅成功弹窗
        initSuccessDialog: function () {
            var config = {
                title: '订阅成功',
                className: 'success-subscribe',
                body: '<div class="success-content">'
                    + '链接更新内容时，您将收到实时通知，可在网盘app「共享-订阅的分享」查看管理链接</div>',
                draggable: false,
                width: '512px',
                position: {
                    xy: 'center'
                },
                buttons: [
                    {
                        name: 'confirm',
                        title: '我知道了',
                        type: 'big',
                        color: 'blue',
                        position: 'center',
                        padding: [50, 50],
                        click: function () {
                            dialog.hide();
                            context.log.send({
                                type: 'tc_succeed_clk',
                                value: '订阅成功弹窗点击'
                            });
                        }
                    }
                ]
            };
            dialog = context.ui.window(config);
        },
        // 取消订阅弹窗
        initCancelDialog: function () {
            var config = {
                title: '取消订阅',
                className: 'cancel-subscribe',
                body: '<div class="cancel-content">'
                    + '不再订阅此分享后，将不再收到更新内容时的实时通知</div>',
                draggable: false,
                width: '480px',
                position: {
                    xy: 'center'
                },
                buttons: [
                    {
                        name: 'confirm',
                        title: '继续订阅',
                        type: 'big',
                        color: 'blue',
                        position: 'center',
                        padding: [50, 50],
                        click: function () {
                            dialog.hide();
                            context.log.send({
                                type: 'tc_cancel_2_clk',
                                value: '取消订阅弹窗继续订阅点击'
                            });
                        }
                    },
                    {
                        name: 'cancel',
                        title: '不再订阅',
                        type: 'big',
                        position: 'center',
                        padding: [50, 50],
                        click: function () {
                            dialog.hide();
                            pri.util.cancelSubscribe();
                            context.log.send({
                                type: 'tc_cancel_1_clk',
                                value: '取消订阅弹窗不再订阅点击'
                            });
                        }
                    }
                ]
            };
            dialog = context.ui.window(config);
        },
        // 订阅引导
        subscribeTipsShow: function () {
            var hasShowSubTips = localStorage.getItem('has_showsubtips') || false;
            if (hasShowSubTips || pri.conf.hasSubscribed) {
                return;
            }
            $('.subscribe-tips').show();
            setTimeout(function () {
                localStorage.setItem('has_showsubtips', true);
                $('.subscribe-tips').hide();
            }, 5000);
        }
    },
    init: function (tplType, isThirdLink) {
        var key = pri.util.getSekey();
        if (key) {
            var keyParam = '&is_from_web=true&sekey=' + key;
            pri.api.querySubscribApi += keyParam;
            pri.api.addSubscribeApi += keyParam;
            pri.api.cancelSubscribeApi += keyParam;
        }
        // 获取是否自动订阅外链小流量
        pri.util.getAutoSubStatus();
        // 获取外链订阅状态
        pri.util.querySubscribInfo();
        // 处理订阅按钮位置
        setTimeout(function () {
            var right = $('.x-button-box').width() + 2;
            var sharePageType = window.SHAREPAGETYPE;

            if (tplType === 'old') {
                if (sharePageType === 'single_file_page') {
                    $('.subscribe-btn',).css({
                        right: right + 'px'
                    });
                    $('.subscribe-tips',).css({
                        right: (right - 156) + 'px',
                        bottom: '0'
                    });
                    if (isThirdLink) {
                        $('.subscribe-btn',).css({
                            right: $('.x-button-box').width() + 26,
                            bottom: '44px'
                        });
                    }
                } else {
                    $('.subscribe-tips',).css({
                        right: (right - 156) + 'px',
                        bottom: '-9px'
                    });
                    if (isThirdLink) {
                        $('.subscribe-btn',).css({
                            top: '35px',
                            right: $('.x-button-box').width() - 4
                        });
                    }
                }
            } else {
                if (sharePageType === 'single_file_page') {
                    $('.subscribe-btn',).css({
                        right: right + 'px',
                        bottom: '39px'
                    });
                    $('.subscribe-tips',).css({
                        right: (right - 156) + 'px',
                        bottom: '0'
                    });

                    if (isThirdLink) {
                        $('.subscribe-tips').css({
                            right: 0,
                            bottom: '-3px'
                        });
                        $('.subscribe-tips').addClass('subscribe-tips-third');
                    }
                } else {
                    $('.subscribe-tips',).css({
                        right: (right - 156) + 'px',
                        bottom: '-9px'
                    });
                    if (isThirdLink) {
                        $('.subscribe-btn',).css({
                            right: 0
                        });
                    } else {
                        $('.subscribe-btn',).css({
                            right: '183px',
                            bottom: '32px'
                        });
                    }
                }
            }
            if (tplType === 'new' && isThirdLink) {
                $('.subscribe-btn',).css({
                    borderRadius: '16px'
                });
            }
            if (isThirdLink && (sharePageType === 'single_file_page' || sharePageType === 'multi_file')) {
                var downloadBtn = $('.slide-show-right .g-button.tools-share-V20-btn[title*="下载"]');
                downloadBtn.addClass('last_btn');
            }
             // 处理按钮样式
            if (window.locals.get('self')) {
                $('.tools-share-V20-btn[node-type="unLinkShare"]').addClass('first_btn');
            }
        }, 500);
    }
};

module.exports = pri;
 
});
;define('disk-share:widget/pageModule/share-header/btns.js', function(require, exports, module){ /**
 * @file 处理点赞、评论、分享等
 * @author: yuanchengyong@baidu.com
 * @date: 16/3/16
 */

var $ = require('base:widget/libs/jquerypacket.js');
var context = require('system-core:context/context.js').instanceForSystem;
var fileList = window.locals.get('file_list') || [];
var fileMeta = fileList[0] || {};

var pri = {
    obj: {
        isAlreadyGetLike: false,
        shareFileName: ''

    },
    mod: {
        like: 'a.funcs-tui',
        share: 'div.funcs-share',
        panel: '#bdshare_panel',
        shareArea: 'span.funcs-share-area'
    },
    api: {
        getLikes: '/pcloud/like/data',
        shareList: '/share/list'
    },
    util: {
        // 获取文件名称
        getFileName: function () {
            pri.obj.shareFileName = fileMeta.server_filename;
            if (window.SHAREPAGETYPE === 'multi_file') {
                pri.obj.shareFileName += '等';
            }
        },
        // 获取评论等数据
        getLikes: function () {
            if (pri.obj.isAlreadyGetLike) {
                return;
            }
            $.ajax({
                type: 'post',
                url: pri.api.getLikes,
                data: {
                    type: 1,
                    query_uk: window.locals.get('share_uk'),
                    source_id: window.locals.get('shareid')
                },
                dataType: 'json',
                timeout: 100000,
                success: function (data) {
                    if (pri.obj.isAlreadyGetLike) {
                        return;
                    }
                    if (data && data.errno === 0) {
                        pri.obj.isAlreadyGetLike = true;
                        pri.util.upDateLike(data);
                    }
                }
            });
        },
        // 更新按钮
        upDateLike: function (data) {
            var likeText = '';
            // var commentText = '';
            var likeCount = data.like_count > 999 ? '999+' : data.like_count;
            // var commentCount = data.comment_count > 999 ? '999+' : data.comment_count;
            // 自己赞过
            if (data && data.like_status === 1) {
                likeText = '已赞(' + likeCount + ')';
                $(pri.mod.like).children('em').removeClass('tui_icon');
            }
            // 自己未赞过
            else if (data && data.like_status === 0) {
                likeText = '赞(' + likeCount + ')';
                $(pri.mod.like).children('em').addClass('tui_icon');
            }

            $(pri.mod.like).data({
                count: data.like_count,
                status: data.like_status
            });
            $(pri.mod.like).children('b').text(likeText);
        },
        /**
         * 获取外链包中文件列表
         * @returns {Promise} 返回请求Promise
         */
        getShareList: function () {
            var _surl = window.location.pathname.split('/s/')[1] || '';
            var url = pri.api.shareList;
            var newSurl = window.location.pathname;
            var linkSource = '';

            if (/\/link\//.test(newSurl)) {
                // 三方外链
                var urlParts = newSurl.split('/');
                newSurl = urlParts[3];
                linkSource = urlParts[2];
            } else {
                // 个人外链 - 去掉字符串开头的1
                newSurl = _surl.split('').slice(1).join('');
            }

            url += '?web=5&app_id=250528&desc=1&showempty=0&page=1&num=20&order=time&shorturl=' + newSurl + '&root=1&view_mode=1';

            return new Promise((resolve, reject) => {
                $.ajax({
                    url,
                    type: 'GET',
                    context: this, // 确保回调函数中的this指向FileTreeDialog实例
                    error: (err) => {
                        console.error('share/list error:', err);
                        reject(err);
                    },
                    success: function(res) {
                        if (res.errno === 0 && res.list) {
                            var fileData = res.list || [];
                            var allShareFileFsid = fileData.map(item =>
                                item.fs_id || item.fsid || ''
                            );
                            sessionStorage.setItem('share_files_fsids', JSON.stringify(allShareFileFsid));
                            resolve(res.list);
                            context.extend({
                                shareInfo: {
                                    status: 'success',
                                    sharePath: res.title
                                }
                            });
                        } else {
                            console.warn('share/list response:', res);
                            reject(new Error('Invalid response'));
                        }
                    }
                });
            });
        },
    },
    bindEvent: function () {
        // 赞按钮事件
        $(pri.mod.like).on('click', function () {
            context.log.send({
                name: 'web_share_click_like',
                value: '外链页点击赞'
            });
            var btnDOM = $(this);
            context.message.callPlugin('网盘链接管理-点赞@com.baidu.pan.share', {
                state: +btnDOM.data('status'),
                sourceUk: window.locals.get('share_uk'),
                type: 0,
                sourceId: window.locals.get('shareid'),
                ele: $('#albumTui'),
                btnDom: btnDOM
            });
        });
    },
    init: function () {
        pri.util.getFileName();
        pri.bindEvent();
        pri.util.getLikes();
        pri.util.getShareList();
    }
};

pri.init();

 
});
;define("disk-share:widget/pageModule/share-header/reportBad.js",function(e,t,o){var i=e("base:widget/libs/jquerypacket.js"),r=e("system-core:context/context.js").instanceForSystem,n={obj:{reportDialog:null,reportOkDialog:null},mod:{reportInfoBox:"div.report-info-box",btnReport:"a[node-type=btn-report]",reportReason:"div[node-type=report-reason] input",reportReasonSpan:"div[node-type=report-reason] span"},tmpl:{reportTitle:'<ol><li>影视、音乐、软件、文学等版权类和其他侵权投诉<a target="_blank" href="http://copyright.baidu.com/index.php/index/complaint" >侵权投诉</a></li><li class="report-mt20">违法有害信息，请在下方选择原因提交举报。</li></ol>',reportContent:'<div class="report-reason" node-type="report-reason"><p class="report-reason-title">举报原因：</p><span><input type="radio" value="2" checked="checked"  name="reportReason" /><label>色情低俗</label></span><span><input type="radio" value="5"  name="reportReason" /><label>涉嫌违法犯罪</label></span><span><input type="radio" value="4"  name="reportReason" /><label>时政信息不实</label></span><span><input type="radio" value="3"  name="reportReason" /><label>血腥暴力</label></span></div>',reportOkContent:'<div class="report-ok-info"><div class="report-ok-left"></div><div class="report-ok-right"><p>举报成功,谢谢!</p><p>您的举报我们会尽快处理,感谢您对百度网盘的支持</p></div></div>'},api:{sumitReason:"/api/report/bad"},util:{getDialog:function(e,t){return n.obj[e]||(n.obj[e]=r.ui.window(t)),n.obj[e]},newReportDialog:function(e){var t,o,i="",r="";r=e&&"sharelink"===e.feture||e&&"sharefile"===e.feture?n.tmpl.reportTitle+n.tmpl.reportContent:n.tmpl.reportContent,i=e&&"groupfile"===e.feture?"举报文件":"举报",o={title:i,body:'<div class="content"><div class="alert-dialog-msg">'+r+"</div></div>",draggable:!0,width:480,position:{xy:"center"},buttons:[{name:"confirm",title:"提交",type:"big",color:"blue",padding:["50px","50px"],position:"center",click:function(){n.util.reportBtnOk(e)}}]},t=n.util.getDialog("reportDialog",o),t.$dialog.addClass("report-info-box"),t.show(),n.util.bindEvent()},newReportOkDialog:function(){var e,t;e={title:"成功",body:'<div class="content"><div class="alert-dialog-msg">'+n.tmpl.reportOkContent+"</div></div>",draggable:!1,width:480,position:{xy:"center"},noHeader:!0},t=n.util.getDialog("reportOkDialog",e),t.$dialog.addClass("report-info-box"),t.show(),i("#"+t.dialogId).off().on("click",function(){t.hide()}),setTimeout(function(){t.hide()},3e3)},reportBtnOk:function(e){e.report_type=i(n.mod.reportReason+":checked").val(),n.util.reportSubmt(e)},reportSubmt:function(e){var t=r,o=e;return 1!==window.locals.get("loginstate")?(n.util.toLogin(),!1):(n.util.getDialog("reportDialog").hide(),void i.post(n.api.sumitReason,o,function(e){e&&0===e.errno?n.util.newReportOkDialog():e&&-6===e.errno?n.util.toLogin():t.ui.tip({mode:"caution",msg:t.errorMsg(e.errno,"请稍候重试!"),sticky:!1})}))},toLogin:function(){window.yunHeader.login.util.loginNew()},reportLogger:function(e){r.log.send({name:"shareReportBad",value:"外链页举报"+e})},getWidgets:function(t,o){e.async(t,function(){o.apply(this,arguments)},function(){r.ui.tip({mode:"caution",msg:"组件加载失败"})})},bindEvent:function(){i("body").on("click",n.mod.reportReasonSpan,function(){i(this).children("input").prop("checked",!0)})}}},a=function(){var e=[],t={},o=r,a=o.list.getSelected(),l=!1,p=!1;for(var s in a)e.push(a[s].fs_id),1===a[s].isdir&&(l=!0);return e.length>10&&(p=!0),l?(o.ui.tip({msg:"不能举报文件夹",mode:"caution"}),!1):p?(o.ui.tip({msg:"单次举报不能超过10个文件",mode:"caution"}),!1):void window.locals.get("share_uk","shareid",function(o,r){t=e&&e.length>0?{tpl:encodeURI("report"),feture:encodeURI("sharefile"),item_id:i.stringify(e),item_url:window.location.href,item_uk:o}:{tpl:"report",feture:"sharelink",item_id:i.stringify([r]),item_url:window.location.href,item_uk:o},n.util.newReportDialog(t),n.util.reportLogger(t.feture)})};i(".report-bad").click(function(){a()}),o.exports.init=a});
;define("disk-share:widget/pageModule/start/preFetchData.js",function(e,t,a){var n=e("base:widget/libs/jquerypacket.js"),o=e("disk-share:widget/system/util/util.js"),c={api:{getCompanyList:"/api/enterprise/organization/allorganizationinfo",showSyncSpace:"/act/api/conf?conf_key=working_space_is_show_share_save",tipsConfApi:"/act/api/conf?conf_key=working_space_share_save_tips",getWorkSpaceStatus:"/workspace/userquery",yunPrintSwitch:"/act/api/conf?conf_key=cloud_print_guide_web",getCollabSpaceList:"/ostp/sharedspace/member/getallsharedspaceinfo"},util:{mapList:function(e){var t=e.map(function(e){var t=e.orgInfo;return{ciduk:t.ciduk,name:t.name,desc:"空间容量"+o.toFriendlyFileSize(t.company_quota_used)+"/"+o.toFriendlyFileSize(t.company_quota),used:o.toFriendlyFileSize(t.company_quota_used),total:o.toFriendlyFileSize(t.company_quota),cid:t.cid,avator:o.getFirstWord(t.name),brief:t.brief,productType:t.product_type,role:t.role,total_user_num:t.total_user_num,avatorImg:t.logo,certStatus:t.cert_status,cancelCert:t.cancel_status}});return t},preFetchInit:function(){c.util.getCompanyListFn(),c.util.getIsShowSyncSpace(),c.util.getTipsConf(),c.util.queryWorkSpaceUseStatus(),c.util.getYunPrintSwitch(),c.util.getCollabSpaceListFn()},getCompanyListFn:function(){n.ajax({url:c.api.getCompanyList,data:{},type:"get",dataType:"json",success:function(e){var t=e.data,a=[];a=t&&t.length>0?c.util.mapList(t):[],window.locals.set("preFetchCompanyList",a)},error:function(){window.locals.set("preFetchCompanyList",[])}})},getIsShowSyncSpace:function(){n.ajax({url:c.api.showSyncSpace,data:{},type:"get",dataType:"json",success:function(e){0===e.errno&&e.data&&e.data.length?window.locals.set("preFetchIsShowSyncSpace","true"===e.data[0].conf_value.isShow):window.locals.set("preFetchIsShowSyncSpace",!1)},error:function(){window.locals.set("preFetchIsShowSyncSpace",!1)}})},getTipsConf:function(){n.ajax({url:c.api.tipsConfApi,type:"get",dataType:"json",success:function(e){var t=e.data[0].conf_value||{};window.locals.set("preFetchTipsConf",t)},error:function(){window.locals.set("preFetchTipsConf",{})}})},getYunPrintSwitch:function(){n.ajax({url:c.api.yunPrintSwitch,type:"get",dataType:"json",success:function(e){var t=e.data[0]&&e.data[0].conf_value||{};window.locals.set("preFetchNewPrintSwitch",t)},error:function(){window.locals.set("preFetchNewPrintSwitch",{})}})},queryWorkSpaceUseStatus:function(){n.ajax({url:c.api.getWorkSpaceStatus,type:"get",dataType:"json",success:function(e){var t=e.data&&!!e.data.is_used;window.locals.set("preFetchIsWorkSpaceUser",t)},error:function(){window.locals.set("preFetchIsWorkSpaceUser",!1)}})},getCollabSpaceListFn:function(){n.ajax({url:c.api.getCollabSpaceList,data:{biz_id:1,page:1,size:1e3},type:"get",dataType:"json",success:function(e){var t=e.data&&e.data.sharedSpaceInfos||[],a=[];t&&t.length>0&&(a=t.map(function(e){return{spaceId:e.sharedSpaceId||e.spaceId||e.id,name:e.sharedSpaceName||e.spaceName||e.name,avatorImg:e.sharedSpaceAvatar||e.spaceAvatar||e.avatar,desc:e.sharedSpaceDesc||e.desc||"团队共享空间",memberCount:e.memberCount||e.member_count||0,_originalSpace:e}})),window.locals.set("preFetchCollabSpaceList",a)},error:function(){window.locals.set("preFetchCollabSpaceList",[])}})}}};a.exports=function(){c.util.preFetchInit()}()});
;define("disk-share:widget/pageModule/share-footer/share-bottom-bar/share-bottom-bar.js",function(o){var t=o("base:widget/libs/jquerypacket.js"),e=o("system-core:context/context.js").instanceForSystem,n=o("disk-share:widget/system/util/logs/bottomShareLog.js"),s=t(".module-share-bottom-bar");e.Broker.initButtonBroker({name:"shareBottomTools",config:{container:s.find(".bar"),limit:2}}),s.find(".bottom_save_btn").on("click",function(){n.sendlog("goSaveClk")}),s.find(".bottom_download_btn").on("click",function(){n.sendlog("downloadClk")}),s.find(".bottom_save_btn").length>0&&n.sendlog("goSaveDis"),s.find(".bottom_download_btn").length>0&&n.sendlog("downloadDis")});
;define("disk-share:widget/pageModule/share-footer/share-footer.js",function(e){function t(){if(window.locals.get("self"))n.ui.tip({msg:"无法转存自己分享的文件",mode:"caution"});else{var e=n.list.getSelected();0===e.length?n.ui.tip({msg:"请至少选择一个文件",mode:"caution"}):n.message.callPlugin("保存到网盘@com.baidu.pan.share",{filesList:e})}}function a(){var e=window.locals.get("username").replace(/@/gi,""),t=r.getItem(e+"_cur_transfer_save_path"),a="我的网盘";if(t){var s=t.split("?");if(s.length>1){var o=s[0],n=parseInt(s[1]||0,10),l=r.getItem(e+"_collab_transfer_save_path");if(l)try{var c=JSON.parse(l);if(Math.abs(n-(c.timestamp||0))<5e3){var g=c.spaceName||"团队共享空间";return a="/"===o?g:g+o,void i(".save-path").text(a)}}catch(h){}a="/"===o?a:a+o}}i(".save-path").text(a)}function s(){var e=new Date,t=e-g>c?!0:!1;if(!t){var a=r.getItem(h);a||(r.setItem(h,!0),i(".bar-tooltip").show(),setTimeout(function(){i(".bar-tooltip").hide()},1e4))}}function o(){i(".bottom-save-path-wrap").length>0&&l.sendlog("pathDis")}var i=e("base:widget/libs/jquerypacket.js"),n=e("system-core:context/context.js").instanceForSystem,r=e("base:widget/storage/storage.js"),l=e("disk-share:widget/system/util/logs/bottomShareLog.js"),c=2592e6,g=new Date("2025-06-16T00:00:00Z"),h=window.locals.get("uk")+"_has_show_btns_tooltip";i(".bottom-save-path-wrap").on("click",function(){t(),l.sendlog("pathClk")}),i(".bar-tooltip-close-btn").on("click",function(){i(".bar-tooltip").hide()}),navigator.userAgent.indexOf("Safari")>-1&&-1===navigator.userAgent.indexOf("Chrome")&&i(".frame-all").css({"min-height":"720px"}),s(),a(),o()});
;define("disk-share:widget/pageModule/share-file-main/share-single.js",function(e){e("system-core:context/context.js").instanceForSystem.message.trigger("share-person-info","show-intro"),e("disk-share:widget/system/util/adPlatform/adPlatform.js").getAdResoucre({list:[{id:"web-sharelinkpic",w:200,h:200},{id:"web-sharesinglebanner",w:710,h:90}]}),window.locals.get("public")&&e("disk-share:widget/system/singleFileComment/singleFileComment.js");var s=e("disk-share:widget/system/util/getCookies.js");window.currentSekey=s("BDCLND")});
;define("disk-share:widget/pageModule/sidebar-business-ad/sidebar-business-ad.js",function(e){var s=e("base:widget/libs/jquerypacket.js"),a=e("base:widget/pc-invoker/invoker.js"),t=e("system-core:context/context.js").instanceForSystem,n=e("disk-share:widget/system/util/logs/pcInvoker.js"),o=e("disk-share:widget/pageModule/share-header/back-client-motivation.js"),i={mod:".module-sidebar-business-ad",content:".business-ad-content",mask:".business-ad-mask",maskImg:".business-ad-mask-img",maskVideo:".business-ad-mask-video",main:"body, #layoutApp",footerText:".module-share-footer *"},d=(s(i.mod),s(i.content)),r=s(i.mask),l=s(i.maskImg),c=s(i.maskVideo),m=700,u=1e3,g={getAd:function(){function e(e){r=e.data,r&&r.type&&("ad"===r.type&&(t.log.send({name:"web_share_list_business_ad_show",value:"外链广告-文件页展示:"+r.name}),console.log("[广告SDK]: 广告模式："+r.name),clearTimeout(l),("ad_conf_default"===r.name||"default"===r.name||r.notShowExternalAd&&"external"===r.adType||!r.data.theme)&&i(),c.className="business-ad-frame",r.data.dynamicColor&&g.setAdThemeColor(r.data.dynamicColor[0])),"dynamicColor"===r.type&&g.setAdThemeColor(r.data))}function i(){o.identifyIsTargetUser().then(function(e){if(d.addClass("theme-default"),e){var s="file_list",t=locals.get("file_list");1!==t.length||t[0].isdir||(s="file"+t[0].category+"_details"),n.send("webDownloadBanner",{page:s},{needExcitation:!0}),g.setAdThemeColor({main:"rgba(242, 246, 254, 1)"}),d.css({cursor:"pointer",backgroundImage:"url(https://staticsns.cdn.bcebos.com/amis/2025-9/1757649059209/ad.png)"}),d.on("click",function(){o.requestIncentiveMark(),a.downloadApp(),n.send("webDownloadBannerClk",{page:s},{needExcitation:!0})})}}),s(c).hide(),t.log.send({name:"web_share_list_business_ad_default",value:"列表页默认广告"})}var r={};window.addEventListener("message",e,!1);var l=setTimeout(function(){console.log("[广告SDK]: 加载异常, 兜底方案"),window.removeEventListener("message",e,!1),i(),t.log.send({name:"web_share_list_business_ad_load_timeout",value:"外链广告-文件页广告加载超时:"+r.name})},3e3),c=document.createElement("iframe"),m=d[0],u=sessionStorage.getItem("B_AD_TYPE");c.src="/buy/ad/home?pathname=/share_weblist&from=weblist",u&&(c.src+="&businessAdType="+u),c.className="business-ad-frame-none",m.appendChild(c),u&&t.log.send({name:"web_share_list_business_ad_trans_show",value:"外链广告-文件页联动广告展示:"+r.name})},getAdRects:function(){return d[0].getBoundingClientRect()},closeMask:function(){var e=this;window.requestAnimationFrame(function(){var s=e.getAdRects();s&&(r.css({"will-change":"transform",transition:"all "+m+"ms",width:s.width||"272px",height:s.height||"588px",top:s.top+"px",left:s.left+"px",opacity:"0","border-radius":"24px"}),l.css({"will-change":"transform",transition:"all "+m+"ms","background-position":"-"+s.left+"px -"+s.top+"px"}),c.css({"will-change":"transform",transition:"all "+m+"ms","margin-left":"-"+s.left+"px","margin-top":"-"+s.top+"px"}))})},setAdThemeColor:function(e){if(e){var a=e.main,t=e.listFooterText;window.requestAnimationFrame(function(){s("head").append('<meta name="theme-color" content="'+s("body").css("background-color")+'"/>'),a&&s(i.main).css({"background-color":a,transition:"background-color 0.1s linear"}),t&&s(i.footerText).css({color:t,transition:"color 0.1s linear"})})}},init:function(){this.closeMask(),setTimeout(function(){g.getAd()},m),setTimeout(function(){r.hide()},u)}};g.init()});
;define("disk-share:widget/pageModule/share-person-info/share-person-info-new.js",function(e){var o=e("base:widget/libs/jquerypacket.js"),n=e("base:widget/storage/storage.js"),t=e("system-core:context/context.js").instanceForSystem,i=e("disk-share:widget/system/util/certThemeRender.js"),s=e("disk-share:widget/system/util/enterpriseThemeRender.js"),a=e("disk-share:widget/system/util/getCookies.js");e("disk-share:widget/pageModule/share-person-info/service/adPanLog.js");var l={mod:".module-share-person-info",followBtn:'a[node-type~="share-follow-btn"]',followTxt:'span[node-type~="follow-txt"]',sharePersonInfoTmpl:'textarea[node-type~="tmpl-share-person-info"]',sharePersonNumbers:'ul[node-type="share-person-numbers"]',personIcon:".person-icon",addFriend:".verify-friend",sendMag:".verify-send",subBtn:'button[node-type="verb-button"]',iconLine:".share-person-data-top"},r="立即订阅",d="相互订阅",c="已订阅",u="follow",f="",p={captchatype:void 0,captchaidentity:void 0,normalize:function(e,o){if("string"!=typeof e||0===e.length)return e;if(null===o||"string"!=typeof o)return e;var n,t=-1!==e.indexOf("?"),i=e.substring(e.length-1),s="bdstoken="+o;return n="&"===i||"?"===i?e+s:t?e+"&"+s:e+"?"+s},api:{getInfo:"/subscribe/personalpage/userinfo",subApi:"/subscribe/personalpage/follow",addFollow:"/pcloud/friend/addfollow",removeFollow:"/pcloud/friend/removefollow",userReport:"/api/report/user",addFriend:"/mbox/relation/addfriend"}},w=o(l.mod),g={templatePromise:null,templateReady:!1,templateData:{intro:"",avatar_url:"",pubshare_count:0,album_count:0,follow_count:0,fans_count:0,query_uk:"",follow_class:"",fans_class:"",uname:"",follow_txt:r,btnClass:""},getShareUserIntro:function(){o.ajax({type:"post",url:p.api.getInfo,crossDomain:!0,xhrFields:{withCredentials:!0},contentType:"application/x-www-form-urlencoded",data:{uk:window.locals.get("share_uk")},success:function(e){if(e&&!e.errno){var n=e.user_info;if(n&&n.is_bussiness){var i=o(l.iconLine);o(l.addFriend).hide(),o(l.sendMag).hide(),i.append('<a href="'+n.shop_url+'" class="duxiaomai sicon"><em></em></a>')}if(!window.locals.get("self")){t.log.send({name:"sub_btn_display_count",value:"外链页【订阅】按钮出现的次数用户数"});var s="";n&&n.is_follow?(s="取消订阅",u="cancel",f="cancel"):s="订阅",w.append('<div node-type="verb-info" class="verb-info"><button node-type="verb-button" class="verb-button '+f+'">'+s+"</button></div>")}}}})},addFollow:function(e,n){o.ajax({url:p.normalize(p.api.addFollow,window.locals.get("bdstoken")),type:"post",data:{appid:e.appid||null,follow_uk:e.uk||null,follow_uname:e.uname||null,mark_name:e.mark_name||null,group_id:e.group_id||null},dataType:"json",success:function(e){n(e.errno)}}),this.reportLogger()},delFollow:function(e,n){o.ajax({url:p.normalize(p.api.removeFollow,window.locals.get("bdstoken")),type:"post",data:{follow_uk:e.uk},dataType:"json",success:function(e){n(e.errno)}}),this.reportLogger()},reportLogger:function(e){e=e?e:"web_friend_api",o.ajax({url:p.api.userReport,type:"POST",data:{timestamp:Math.round(new Date/1e3),action:e}})},addFriend:function(e,n){var i=window.locals.get("share_uk"),s=p.api.addFriend+"?uk="+i+"&type=normal&scene=0",a=t.ui.tip({mode:"loading",msg:"发送中..."});o.post(s,e,function(e){a.hide(),n(e)})},disposeAddFriend:function(n,i){var s=this;p.input&&o.extend(n,{input:p.input,vcode:p.vcode}),this.addFriend(n,function(a){if("string"==typeof a)try{a=JSON.parse(a)}catch(l){}if(a&&0===a.errno)return 2===a.status?(o(".verify-friend").css("opacity",.6).html("等待验证"),void i.hide()):(t.ui.tip({mode:"success",msg:"添加好友成功",sticky:!1}),i.hide(),void location.reload());if(a&&2165===a.errno)return void t.ui.tip({mode:"caution",msg:"对方拒绝任何人添加其为好友",sticky:!1});if(a&&2163===a.errno){var r=a.permission.type;if(o(".add-friend").attr("data-type",r),0===+r)i.show();else if(2===+r){var d=a.permission.question;o(".verify-hint").html("问题："+d+"?"),o(".verify-text").attr("maxlength",20),i.show()}}else if(a&&-19===a.errno)i.hide(),e("disk-share:widget/system/verifyCodeDialog/newVerify.js").show({onSubmitFunc:function(e,o){p.captchatype=o,p.captchaidentity=e,s.disposeAddFriend(n)}});else{var c=a.errno,u="";if(-6===c)return void window.yunHeader.login.util.loginNew();switch(c){case 2117:u="好友超出限制了";break;case 2118:u="已经是好友",location.reload();break;case 2115:u="不能添加自己为好友";break;case 2164:u="问题回答错误";break;default:u="加好友太频繁，请稍后再试"}t.ui.tip({mode:"caution",msg:u,sticky:!1})}})},_bindEvent:function(){var e,i=this,s={};this._bindLogEvent(),w.delegate(l.subBtn,"click",function(){t.log.send({name:"sub_btn_click_count",value:"外链页【订阅】按钮被点击的次数用户数"}),o.ajax({type:"post",url:p.api.subApi,crossDomain:!0,xhrFields:{withCredentials:!0},contentType:"application/x-www-form-urlencoded",data:{action:u,uk:window.locals.get("share_uk")},success:function(e){if(!e.errno){var n=o(l.subBtn);"订阅"===n.text()?(n.text("取消订阅"),u="cancel",n.addClass(f)):(n.text("订阅"),u="follow",n.removeClass(f))}}})}),w.delegate(l.followBtn,"click",function(a){var u,f,p=o(a.currentTarget),w=p.find(l.followTxt),g=p.data("followtype"),m={uk:window.locals.get("share_uk"),uname:window.locals.get("linkusername"),appid:123123};return 1!==window.locals.get("loginstate")?(window.yunHeader.login.util.loginNew(),window.yunHeader.on("loginSuccess",function(){n.setItem("followAction","1")}),!1):(p.hasClass("follow")?(m.follow_uname=i.templateData.uname,w.html("订阅中"),p.removeClass("follow").addClass("following"),i.addFollow(m,function(e){e?(w.html(r),p.removeClass("following").addClass("follow"),t.ui.tip(-6===e?{mode:"caution",msg:"订阅失败，用户未登录",sticky:!1}:{mode:"caution",msg:"订阅失败，请刷新后再试",sticky:!1})):1===g?(w.html(d),p.removeClass("following").addClass("mutualfollow").data("followtype",2)):(w.html(c),p.removeClass("following").addClass("followed").data("followtype",0))})):p.hasClass("followed")?(s={title:"取消订阅",className:"un-follow",body:'<div class="content">确定不再订阅“'+m.uname+"”了吗？</br>(取消订阅后你就不能看到TA的分享动态了哦。)</div>",draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){u()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){f()}}]},w.html("取消中"),p.removeClass("followed").addClass("unfollowing"),"undefined"==typeof e&&(e=t.ui.window(s)),e.show(),u=function(){e.hide(),i.delFollow(m,function(e){e?(console.warn("del follow fail"),w.html(c),p.removeClass("unfollowing").addClass("followed")):(w.html(r),p.removeClass("unfollowing").addClass("follow").data("followtype",-1))})},f=function(){e.hide(),w.html(c),p.removeClass("unfollowing").addClass("followed")}):p.hasClass("mutualfollow")&&(s={title:"取消订阅",className:"un-follow",body:'<div class="content">确定不再订阅“'+m.uname+"”了吗？</br>(取消订阅后你就不能看到TA的分享动态了哦。)</div>",draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){u()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){f()}}]},"undefined"==typeof e&&(e=t.ui.window(s)),w.html("取消中"),p.removeClass("mutualfollow").addClass("unfollowing"),e.show(),u=function(){e.hide(),i.delFollow(m,function(e){e?(console.warn("del follow fail"),w.html(d),p.removeClass("unfollowing").addClass("mutualfollow")):(w.html(r),p.removeClass("unfollowing").addClass("follow").data("followtype",1))})},f=function(){w.html(d),p.removeClass("unfollowing").addClass("mutualfollow")}),!1)}),w.delegate(l.addFriend,"click",function(){if(t.log.send({type:"web_share_person_click_add_friend",value:"外链页详情页点击加好友"}),1!==+window.locals.get("loginstate"))return void window.yunHeader.login.util.loginNew();var n="等待验证"===o(this).text();if(!n){var s={title:"添加好友",className:"add-friend",body:'<div class="verify-content"><div class="verify-hint">对方需要你填写验证信息:</div><div class="verify-text-wrap"><textarea class="verify-text" maxlength="40"></textarea></div></div>',draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){a()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){l()}}]};"undefined"==typeof e&&(e=t.ui.window(s));var a=function(){var n=o(".add-friend").data("type"),s=o(".verify-text").val().trim(),a={};if(s.length<1)return void t.ui.tip({mode:"caution",msg:"请填写好友申请验证信息",sticky:!1});var l=40;return 0===+n&&(a.text=s),2===+n&&(l=20,a.answer=s),s.length>l?void t.ui.tip({mode:"caution",msg:"输入不能超过"+l+"个字符",sticky:!1}):void i.disposeAddFriend(a,e)},l=function(){e.hide()};i.disposeAddFriend({},e)}}),w.delegate(l.sendMag,"click",function(){t.log.send({type:"web_share_person_click_send_msg",value:"外链页详情页点击发送消息"});var e=window.host&&window.host.HOST_PAN||"pan.baidu.com";window.open("https://"+e+"/mbox/homepage#share/type=session&fromUk="+window.locals.get("share_uk"))})},_bindLogEvent:function(){w.delegate(".share-person-avatar a","click",function(){}),w.delegate(".share-person-username","click",function(){}),w.delegate(".sicon","click",function(){t.log.send({name:"dlink_personal_info_sicon",value:"外链页个人信息皇冠icon"})})},getIntro:function(){o.get("/pcloud/user/getinfo",{query_uk:window.locals.get("share_uk"),third:0},function(e){if(e&&!e.errno){var n="";e.user_info&&e.user_info.intro&&(n="暂无签名"===e.user_info.intro?"":e.user_info.intro),""!==n&&o(".author-desc .author-intro").text(n)}})},setVipIcon:function(){this.sendReportLoggerHandler("web_share_browse"),window.locals.get("owner_vip_type","owner_vip_level",function(n,i){if(2===n&&i){var s="vipicon-"+n+"-"+i;0===i&&(s+=" cover"),s+=" vipicon",o(".share-person-data .sicon").addClass(s)}2===n&&e("disk-share:widget/system/util/makeup.js")("sharelist",t)})},setCertIcon:function(){var e=this;i("sharelist",function(o){o.isCertUser&&o.useCertTheme?(e.sendReportLoggerHandler("web_enterprise_owner_share_browse"),o.isOwner||t.log.send({name:"understand_cert_share-person_display_count",value:"企业用户分享-外链-头像下-了解企业账号"}),e.setBannerHide()):e.setVipIcon()},function(){e.setVipIcon()})},sendReportLoggerHandler:function(e){1===+window.locals.get("loginstate")&&this.reportLogger(e)},setEnterpriseInfo:function(){var e=this;s("sharelist",function(o){o.isEnterpriseLink?(e.sendReportLoggerHandler("web_enterprise_share_browse"),t.log.send({type:"web_share_list_page_enterprise_display",value:"web-企业空间-文件列表页-展示"}),e.setBannerHide()):e.setCertIcon()},function(){e.setCertIcon()})},setBannerHide:function(){o("#web-right-view").hide(),o("#web-single-bottom").hide(),o("#web-multi-bottom").hide()},init:function(){this.getIntro(),this._bindEvent(),this.setEnterpriseInfo(),this.setBannerHide(),window.currentSekey=a("BDCLND")}};t.message.listen("share-person-info",function(e){"show-intro"===e&&g.getShareUserIntro()}),g.init()});
;define("disk-share:widget/pageModule/share-header/share-top-bar/share-top-bar.js",function(e){var r=e("base:widget/libs/jquerypacket.js"),t=e("system-core:context/context.js").instanceForSystem,a=r(".module-share-top-bar");t.Broker.initButtonBroker({name:"shareTools",config:{container:a.find(".bar"),limit:5}})});
;define('disk-share:widget/pageModule/share-header/share-header-new.js', function(require, exports, module){ /* jslint browser: true, vars: true, nomen: true, indent: 4, maxlen: 110, plusplus: true, sloppy: true */
/* global mdev: true, console: true, require: true, yunData: true */

/**
 * @version [v1.0] 2014-07-07
 * @description share-person-info.js
 */


var $ = require('base:widget/libs/jquerypacket.js');
var tools = require('base:widget/tools/tools.js');
var storage = require('base:widget/storage/storage.js');
var context = require('system-core:context/context.js').instanceForSystem;
var util = require('disk-share:widget/system/util/util.js');
var agentUbcLog = require('disk-share:widget/system/util/logs/agentLog.js');
require('disk-share:widget/pageModule/share-header/reportBad.js');
require('disk-share:widget/pageModule/share-header/btns.js');
var subscribeLink = require('disk-share:widget/pageModule/share-header/subscribe-outside-link.js');
var joinFolder = require('disk-share:widget/pageModule/share-header/join-folder.js');
var backClientMotivation = require('disk-share:widget/pageModule/share-header/back-client-motivation.js');
var BpABTest = require('disk-share:widget/system/util/ab.js');
var shareIm = require('disk-share:widget/pageModule/share-header/share-im/share-im.js');

var isThirdLink = location.pathname.indexOf('/link/') > -1 || /(\?|&)linksource=/.test(location.search);
var fileList = window.locals.get('file_list') || [];
var fileMeta = fileList[0] || {};
var fileName = tools.toEntity(fileMeta.server_filename);
var fileExtension = '';
var fileNameDom = $('.module-share-header .file-name');
var fileIconV20 = $('.module-share-header .files-icon-v20');
var isAutoExtractPwd = util.getSearch('pwd') || '';
var isWp = +fileMeta.wpfile === 1;
if (isWp) {
    fileName = fileName.replace(/\.(\w*?)$/, '');
    $('title').text(fileName + '_免费高速下载|百度网盘-分享无限制');
}
var staticPath = 'https://staticwx.cdn.bcebos.com/mini-program/images/';
var fileIconImg = '';
var icon = '';
var isKnowledgeLink = window.locals.get('is_knowledge') || 0;

if (isKnowledgeLink) {
    joinFolder.init();
} else {
    subscribeLink.init('new', isThirdLink);
}

$('.no-login-text-dingyue').text('订阅');
// $('.subscribe-btn').css('right', '385px');
$('.module-share-top-bar').addClass('new-disk-share-bar');

switch (window.SHAREPAGETYPE) {
    case 'single_file_page':
        fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase();
        fileIconImg = staticPath + 'ic_other_v2.png';
        try {
            icon = util.getIconByExt(fileName);
            fileIconImg = staticPath + 'ic_' + icon +  '_v2.png';
        } catch (e) {}
        break;
    case 'multi_file':
        if (fileList.length === 1 && fileMeta.isdir) {
            fileExtension = 'dir';
            icon = 'dir';
        } else {
            fileExtension = 'multi';
            fileName += '等';
        }
        break;
}

window.locals.get('cfrom_id', 'owner_vip_type', 'sharetype', 'title_img', 'is_knowledge', function (id, vipType, sharetype, titleImg, isKnowledge) {
    context.log.send({
        name: 'web_third_link_page_show',
        value: {
            value: '外链页展示',
            from: Number(id),
            from0: vipType,
            refer: document.referrer
        }
    });
    // 串联agent数据,增加ubc打点
    try {
        var agentInfo = localStorage.getItem('BD_PAN_AGENT_INFO') || '';
        var [t, agentid, agentchannel] = agentInfo.split("_");
        var isSffective = t && new Date().getTime() - t < 86400000 ? true : false;

        if (isSffective) {
            agentUbcLog.sendlog("codeSuccessPageShow", {
                agentid,
                agentchannel
            });
        }
    } catch(err) {
        console.log('agent数据串联error', err);
    }


    if (isAutoExtractPwd) {
        context.log.send({
            type: 'web_auto_extract_shareLink_display',
            value: '自动填充提取码-外链页展示'
        });
    } else {
        context.log.send({
            type: 'web_need_extract_shareLink_display',
            value: '非自动填充提取码-外链页展示'
        });
    }

    if (String(sharetype) === '4' && !isKnowledge) {
        $('.verify-user-protect-share-list').show();
    }

    fileIconV20.addClass(icon || 'other');
    // 外链单文件标题防止抓取，server 以base64形式下发图片，取title_img数组第一个值
    if (fileList.length === 1 && titleImg && !isThirdLink) {
        var imgDom = titleImg ? '<img style="vertical-align: top;" src=data:image/png;base64,' + titleImg[0]
            + '>' : '<img alt="' + fileName + '" >';
        /* bca-disable */
        fileNameDom.attr('title', '').html(imgDom);
        if (fileExtension === 'dir' || fileExtension === 'multi') {
            var src = 'https://staticsns.cdn.bcebos.com/amis/2024-8/1722592402960/%E6%96%87%E4%BB%B6%E5%A4%B9%20(2).png';
            if (fileExtension === 'multi') {
                src = 'https://staticsns.cdn.bcebos.com/amis/2024-8/1722592345759/%E5%A4%9A%E4%B8%AA%E6%96%87%E4%BB%B6.png';
            }
            fileIconV20.html('<img src="'
            + src + '">');
        } else {
            /* bca-disable */
            fileIconV20.html('<img src="'
            + fileIconImg + '">');
        }

        var isAudio = fileMeta.category === 2;
        if (isAudio) {
            fileNameDom.attr('title', fileName);
        }
    } else {
        fileNameDom.attr('title', fileName)
            .html(fileName);
        if (fileExtension === 'dir' || fileExtension === 'multi') {
            var src = 'https://staticsns.cdn.bcebos.com/amis/2024-8/1722592402960/%E6%96%87%E4%BB%B6%E5%A4%B9%20(2).png';
            if (fileExtension === 'multi') {
                src = 'https://staticsns.cdn.bcebos.com/amis/2024-8/1722592345759/%E5%A4%9A%E4%B8%AA%E6%96%87%E4%BB%B6.png';
            }
            fileIconV20.html('<img src="'
            + src + '">');
        } else {
            /* bca-disable */
            fileIconV20.html('<em class="global-icon-16 global-icon-16-'
            + fileExtension + '"></em> ');
        }
    }
});

// 网盘下载助手统计+临时屏蔽功能
setTimeout(function () {
    var helperSign = [
        '.panHelperBtn',
        '[data-key=downloadhelper]',
        '[node-type=btn-helper]'
    ];
    var $helperBtn = $(helperSign.join(','));
    if ($helperBtn.length) {
        try {
            context.log.send({
                name: 'sharePage_plugin_downloadhelper'
            });

            $.each($helperBtn, function (i, $item) {
                $item.remove();
            });
        } catch (e) {

        }
    }

}, 1000);

// 非登录态点击"保存到网盘"，强制登录，且登录成功后的回调
function checkLoginCallTransfer() {
    if (storage.getItem('transferFiles') === '1') {
        if (!window.locals.get('self')) {
            try {
                storageFiles = storage.getItem('transferFilesContent');
                storageFiles = JSON.parse(storageFiles);
            } catch (error) {
                console.log(error);
            }
            context.message.callPlugin('保存到网盘@com.baidu.pan.share', {
                filesList: storageFiles
            });
        }
        storage.removeItem('transferFiles');
        storage.removeItem('transferFilesContent');
    }
}

// 检测是否是登录回调函数
function checkLoginCallDownload() {
    if (storage.getItem('shareAutoDownload') === '1') {
        context.message.callPlugin('网盘下载@com.baidu.pan');
        storage.removeItem('shareAutoDownload');
    }
}

checkLoginCallTransfer();
checkLoginCallDownload();
backClientMotivation.init();
shareIm.init();
 
});
;define("disk-share:widget/pageModule/share-person-info/share-person-info.js",function(e){var o=e("base:widget/libs/jquerypacket.js"),n=e("base:widget/storage/storage.js"),t=e("system-core:context/context.js").instanceForSystem,i=e("disk-share:widget/system/util/certThemeRender.js"),s=e("disk-share:widget/system/util/enterpriseThemeRender.js"),a=e("disk-share:widget/system/util/getCookies.js");e("disk-share:widget/pageModule/share-person-info/service/adPanLog.js");var l={mod:".module-share-person-info",followBtn:'a[node-type~="share-follow-btn"]',followTxt:'span[node-type~="follow-txt"]',sharePersonInfoTmpl:'textarea[node-type~="tmpl-share-person-info"]',sharePersonNumbers:'ul[node-type="share-person-numbers"]',personIcon:".person-icon",addFriend:".verify-friend",sendMag:".verify-send",subBtn:'button[node-type="verb-button"]',iconLine:".share-person-data-top"},r="立即订阅",d="相互订阅",c="已订阅",u="follow",f="",p={captchatype:void 0,captchaidentity:void 0,normalize:function(e,o){if("string"!=typeof e||0===e.length)return e;if(null===o||"string"!=typeof o)return e;var n,t=-1!==e.indexOf("?"),i=e.substring(e.length-1),s="bdstoken="+o;return n="&"===i||"?"===i?e+s:t?e+"&"+s:e+"?"+s},api:{getInfo:"/subscribe/personalpage/userinfo",subApi:"/subscribe/personalpage/follow",addFollow:"/pcloud/friend/addfollow",removeFollow:"/pcloud/friend/removefollow",userReport:"/api/report/user",addFriend:"/mbox/relation/addfriend"}},w=o(l.mod),g={templatePromise:null,templateReady:!1,templateData:{intro:"",avatar_url:"",pubshare_count:0,album_count:0,follow_count:0,fans_count:0,query_uk:"",follow_class:"",fans_class:"",uname:"",follow_txt:r,btnClass:""},getShareUserIntro:function(){o.ajax({type:"post",url:p.api.getInfo,crossDomain:!0,xhrFields:{withCredentials:!0},contentType:"application/x-www-form-urlencoded",data:{uk:window.locals.get("share_uk")},success:function(e){if(e&&!e.errno){var n=e.user_info;if(n&&n.is_bussiness){var i=o(l.iconLine);o(l.addFriend).hide(),o(l.sendMag).hide(),i.append('<a href="'+n.shop_url+'" class="duxiaomai sicon"><em></em></a>')}if(!window.locals.get("self")){t.log.send({name:"sub_btn_display_count",value:"外链页【订阅】按钮出现的次数用户数"});var s="";n&&n.is_follow?(s="取消订阅",u="cancel",f="cancel"):s="订阅",w.append('<div node-type="verb-info" class="verb-info"><button node-type="verb-button" class="verb-button '+f+'">'+s+"</button></div>")}}}})},addFollow:function(e,n){o.ajax({url:p.normalize(p.api.addFollow,window.locals.get("bdstoken")),type:"post",data:{appid:e.appid||null,follow_uk:e.uk||null,follow_uname:e.uname||null,mark_name:e.mark_name||null,group_id:e.group_id||null},dataType:"json",success:function(e){n(e.errno)}}),this.reportLogger()},delFollow:function(e,n){o.ajax({url:p.normalize(p.api.removeFollow,window.locals.get("bdstoken")),type:"post",data:{follow_uk:e.uk},dataType:"json",success:function(e){n(e.errno)}}),this.reportLogger()},reportLogger:function(e){e=e?e:"web_friend_api",o.ajax({url:p.api.userReport,type:"POST",data:{timestamp:Math.round(new Date/1e3),action:e}})},addFriend:function(e,n){var i=window.locals.get("share_uk"),s=p.api.addFriend+"?uk="+i+"&type=normal&scene=0",a=t.ui.tip({mode:"loading",msg:"发送中..."});o.post(s,e,function(e){a.hide(),n(e)})},disposeAddFriend:function(n,i){var s=this;p.input&&o.extend(n,{input:p.input,vcode:p.vcode}),this.addFriend(n,function(a){if("string"==typeof a)try{a=JSON.parse(a)}catch(l){}if(a&&0===a.errno)return 2===a.status?(o(".verify-friend").css("opacity",.6).html("等待验证"),void i.hide()):(t.ui.tip({mode:"success",msg:"添加好友成功",sticky:!1}),i.hide(),void location.reload());if(a&&2165===a.errno)return void t.ui.tip({mode:"caution",msg:"对方拒绝任何人添加其为好友",sticky:!1});if(a&&2163===a.errno){var r=a.permission.type;if(o(".add-friend").attr("data-type",r),0===+r)i.show();else if(2===+r){var d=a.permission.question;o(".verify-hint").html("问题："+d+"?"),o(".verify-text").attr("maxlength",20),i.show()}}else if(a&&-19===a.errno)i.hide(),e("disk-share:widget/system/verifyCodeDialog/newVerify.js").show({onSubmitFunc:function(e,o){p.captchatype=o,p.captchaidentity=e,s.disposeAddFriend(n)}});else{var c=a.errno,u="";if(-6===c)return void window.yunHeader.login.util.loginNew();switch(c){case 2117:u="好友超出限制了";break;case 2118:u="已经是好友",location.reload();break;case 2115:u="不能添加自己为好友";break;case 2164:u="问题回答错误";break;default:u="加好友太频繁，请稍后再试"}t.ui.tip({mode:"caution",msg:u,sticky:!1})}})},_bindEvent:function(){var e,i=this,s={};this._bindLogEvent(),w.delegate(l.subBtn,"click",function(){t.log.send({name:"sub_btn_click_count",value:"外链页【订阅】按钮被点击的次数用户数"}),o.ajax({type:"post",url:p.api.subApi,crossDomain:!0,xhrFields:{withCredentials:!0},contentType:"application/x-www-form-urlencoded",data:{action:u,uk:window.locals.get("share_uk")},success:function(e){if(!e.errno){var n=o(l.subBtn);"订阅"===n.text()?(n.text("取消订阅"),u="cancel",n.addClass(f)):(n.text("订阅"),u="follow",n.removeClass(f))}}})}),w.delegate(l.followBtn,"click",function(a){var u,f,p=o(a.currentTarget),w=p.find(l.followTxt),g=p.data("followtype"),m={uk:window.locals.get("share_uk"),uname:window.locals.get("linkusername"),appid:123123};return 1!==window.locals.get("loginstate")?(window.yunHeader.login.util.loginNew(),window.yunHeader.on("loginSuccess",function(){n.setItem("followAction","1")}),!1):(p.hasClass("follow")?(m.follow_uname=i.templateData.uname,w.html("订阅中"),p.removeClass("follow").addClass("following"),i.addFollow(m,function(e){e?(w.html(r),p.removeClass("following").addClass("follow"),t.ui.tip(-6===e?{mode:"caution",msg:"订阅失败，用户未登录",sticky:!1}:{mode:"caution",msg:"订阅失败，请刷新后再试",sticky:!1})):1===g?(w.html(d),p.removeClass("following").addClass("mutualfollow").data("followtype",2)):(w.html(c),p.removeClass("following").addClass("followed").data("followtype",0))})):p.hasClass("followed")?(s={title:"取消订阅",className:"un-follow",body:'<div class="content">确定不再订阅“'+m.uname+"”了吗？</br>(取消订阅后你就不能看到TA的分享动态了哦。)</div>",draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){u()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){f()}}]},w.html("取消中"),p.removeClass("followed").addClass("unfollowing"),"undefined"==typeof e&&(e=t.ui.window(s)),e.show(),u=function(){e.hide(),i.delFollow(m,function(e){e?(console.warn("del follow fail"),w.html(c),p.removeClass("unfollowing").addClass("followed")):(w.html(r),p.removeClass("unfollowing").addClass("follow").data("followtype",-1))})},f=function(){e.hide(),w.html(c),p.removeClass("unfollowing").addClass("followed")}):p.hasClass("mutualfollow")&&(s={title:"取消订阅",className:"un-follow",body:'<div class="content">确定不再订阅“'+m.uname+"”了吗？</br>(取消订阅后你就不能看到TA的分享动态了哦。)</div>",draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){u()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){f()}}]},"undefined"==typeof e&&(e=t.ui.window(s)),w.html("取消中"),p.removeClass("mutualfollow").addClass("unfollowing"),e.show(),u=function(){e.hide(),i.delFollow(m,function(e){e?(console.warn("del follow fail"),w.html(d),p.removeClass("unfollowing").addClass("mutualfollow")):(w.html(r),p.removeClass("unfollowing").addClass("follow").data("followtype",1))})},f=function(){w.html(d),p.removeClass("unfollowing").addClass("mutualfollow")}),!1)}),w.delegate(l.addFriend,"click",function(){if(t.log.send({type:"web_share_person_click_add_friend",value:"外链页详情页点击加好友"}),1!==+window.locals.get("loginstate"))return void window.yunHeader.login.util.loginNew();var n="等待验证"===o(this).text();if(!n){var s={title:"添加好友",className:"add-friend",body:'<div class="verify-content"><div class="verify-hint">对方需要你填写验证信息:</div><div class="verify-text-wrap"><textarea class="verify-text" maxlength="40"></textarea></div></div>',draggable:!1,width:"480px",position:{xy:"center"},buttons:[{name:"confirm",title:"确定",type:"big",color:"blue",position:"center",padding:[50,50],click:function(){a()}},{name:"cancel",title:"取消",type:"big",position:"center",padding:[50,50],click:function(){l()}}]};"undefined"==typeof e&&(e=t.ui.window(s));var a=function(){var n=o(".add-friend").data("type"),s=o(".verify-text").val().trim(),a={};if(s.length<1)return void t.ui.tip({mode:"caution",msg:"请填写好友申请验证信息",sticky:!1});var l=40;return 0===+n&&(a.text=s),2===+n&&(l=20,a.answer=s),s.length>l?void t.ui.tip({mode:"caution",msg:"输入不能超过"+l+"个字符",sticky:!1}):void i.disposeAddFriend(a,e)},l=function(){e.hide()};i.disposeAddFriend({},e)}}),w.delegate(l.sendMag,"click",function(){t.log.send({type:"web_share_person_click_send_msg",value:"外链页详情页点击发送消息"});var e=window.host&&window.host.HOST_PAN||"pan.baidu.com";window.open("https://"+e+"/mbox/homepage#share/type=session&fromUk="+window.locals.get("share_uk"))})},_bindLogEvent:function(){w.delegate(".share-person-avatar a","click",function(){}),w.delegate(".share-person-username","click",function(){}),w.delegate(".sicon","click",function(){t.log.send({name:"dlink_personal_info_sicon",value:"外链页个人信息皇冠icon"})})},getIntro:function(){o.get("/pcloud/user/getinfo",{query_uk:window.locals.get("share_uk"),third:0},function(e){if(e&&!e.errno){var n="";e.user_info&&e.user_info.intro&&(n="暂无签名"===e.user_info.intro?"":e.user_info.intro),""!==n&&o(".author-desc .author-intro").text(n)}})},setVipIcon:function(){this.sendReportLoggerHandler("web_share_browse"),window.locals.get("owner_vip_type","owner_vip_level",function(n,i){if(2===n&&i){var s="vipicon-"+n+"-"+i;0===i&&(s+=" cover"),s+=" vipicon",o(".share-person-data .sicon").addClass(s)}2===n&&e("disk-share:widget/system/util/makeup.js")("sharelist",t)})},setCertIcon:function(){var e=this;i("sharelist",function(o){o.isCertUser&&o.useCertTheme?(e.sendReportLoggerHandler("web_enterprise_owner_share_browse"),o.isOwner||t.log.send({name:"understand_cert_share-person_display_count",value:"企业用户分享-外链-头像下-了解企业账号"}),e.setBannerHide()):e.setVipIcon()},function(){e.setVipIcon()})},sendReportLoggerHandler:function(e){1===+window.locals.get("loginstate")&&this.reportLogger(e)},setEnterpriseInfo:function(){var e=this;s("sharelist",function(o){o.isEnterpriseLink?(e.sendReportLoggerHandler("web_enterprise_share_browse"),t.log.send({type:"web_share_list_page_enterprise_display",value:"web-企业空间-文件列表页-展示"}),e.setBannerHide()):e.setCertIcon()},function(){e.setCertIcon()})},setBannerHide:function(){o("#web-right-view").hide(),o("#web-single-bottom").hide(),o("#web-multi-bottom").hide()},init:function(){this.getIntro(),this._bindEvent(),this.setEnterpriseInfo(),window.currentSekey=a("BDCLND")}};t.message.listen("share-person-info",function(e){"show-intro"===e&&g.getShareUserIntro()}),g.init()});
;define("disk-share:widget/pageModule/share-header/share-header.js",function(e){function t(){if("1"===l.getItem("transferFiles")){if(!window.locals.get("self")){try{storageFiles=l.getItem("transferFilesContent"),storageFiles=JSON.parse(storageFiles)}catch(e){console.log(e)}r.message.callPlugin("保存到网盘@com.baidu.pan.share",{filesList:storageFiles})}l.removeItem("transferFiles"),l.removeItem("transferFilesContent")}}function a(){"1"===l.getItem("shareAutoDownload")&&(r.message.callPlugin("网盘下载@com.baidu.pan"),l.removeItem("shareAutoDownload"))}var s=e("base:widget/libs/jquerypacket.js"),i=e("base:widget/tools/tools.js"),l=e("base:widget/storage/storage.js"),r=e("system-core:context/context.js").instanceForSystem,o=e("disk-share:widget/system/util/util.js");e("disk-share:widget/pageModule/share-header/btns.js");var n=e("disk-share:widget/pageModule/share-header/subscribe-outside-link.js"),d=location.pathname.indexOf("/link/")>-1||/(\?|&)linksource=/.test(location.search);n.init("old",d);var g=window.locals.get("file_list")||[],c=g[0]||{},m=i.toEntity(c.server_filename),h="",u=s(".module-share-header .file-name"),f=o.getSearch("pwd")||"",w=1===+c.wpfile;switch(w&&(m=m.replace(/\.(\w*?)$/,""),s("title").text(m+"_免费高速下载|百度网盘-分享无限制")),window.SHAREPAGETYPE){case"single_file_page":h=m.substring(m.lastIndexOf(".")+1).toLowerCase();break;case"multi_file":1===g.length&&c.isdir?h="dir":(h="multi",m+="等")}window.locals.get("cfrom_id","owner_vip_type","sharetype","title_img","is_knowledge",function(e,t,a,i,l){if(r.log.send({name:"web_third_link_page_show",value:{value:"外链页展示",from:Number(e),from0:t,refer:document.referrer}}),r.log.send(f?{type:"web_auto_extract_shareLink_display",value:"自动填充提取码-外链页展示"}:{type:"web_need_extract_shareLink_display",value:"非自动填充提取码-外链页展示"}),"4"!==String(a)||l||s(".verify-user-protect-share-list").show(),1===g.length&&i&&!d){var o=i?'<img style="vertical-align: top;" src=data:image/png;base64,'+i[0]+">":'<img alt="'+m+'" >';u.attr("title","").html('<em class="global-icon-16 global-icon-16-'+h+'"></em> '+o)}else u.attr("title",m).html('<em class="global-icon-16 global-icon-16-'+h+'"></em> '+m)}),setTimeout(function(){var e=[".panHelperBtn","[data-key=downloadhelper]","[node-type=btn-helper]"],t=s(e.join(","));if(t.length)try{r.log.send({name:"sharePage_plugin_downloadhelper"}),s.each(t,function(e,t){t.remove()})}catch(a){}},1e3),t(),a()});
;define("disk-share:widget/system/util/lazyLoadImage.js",function(o,i,t){function a(){function o(){a.isReady=!0,r.isFunction(a.callback)&&a.callback()}o()}function s(o){if(o&&"2"===String(g.HTTPVersion))return"thumbnail10.baidupcs";var i=o?p:_;return g[i][f++%10]}function n(o){if(!o)return!1;if(o.src)return!1;var i=o.getAttribute("_src"),t=i.indexOf(u)>-1,a=i.indexOf(h)>-1;if(!t&&!a)return!1;var n=t?u:h,e=u;t&&m&&(e=s()),a&&(e=s(!0)),n!==e&&(i=i.replace(n,e)),o._src=i}function e(){c.call(this),this.images=[]}var r=o("base:widget/libs/underscore.js"),c=o("base:widget/tools/service/tools.event.js").EventEmitter,l=o("base:widget/tools/service/tools.util.js"),m="http:"===document.location.protocol,d=window.host&&window.host.HOST_D_PCS||"d.pcs.baidu.com",u=d,h="thumbnail0.baidupcs.com",g={HTTPVersion:"1.1",normalDomains:[],thumbsDomains:[]},f=0,_="normalDomains",p="thumbsDomains",w=window.host&&window.host.SOURCE_VALUE,b=Number(w);isNaN(b)&&(window.host&&(window.host.HOST_BAIDU_PCS="baidupcs.com"),b=10);for(var I=0;b>I;I++){var v=".";window.host&&window.host.HOST_BAIDU_PCS&&2===b&&(v="-"),g.thumbsDomains.push("thumbnail"+I+v+(window.host&&window.host.HOST_BAIDU_PCS||"baidupcs.com"))}a.isReady=!1,a(),l.inherits(e,c),e.prototype.changeImages=function(o){if([].push.apply(this.images,o||[]),a.isReady)this._loadImage();else{var i=this;a.callback=function(){i._loadImage()}}},e.prototype._loadImage=function(){if(0!==this.images.length){var o=this.images.shift(),i=n(o);i!==!1&&(this._installImage(o),this._loadImage())}},e.prototype._installImage=function(o){var i=r.now(),t=this;o.hasError||(o.src=o._src),o.complete?t._loadImageSucc(o):(o.onload=function(){t._loadImageSucc(this,r.now()-i)},o.onerror=function(){o.hasError=!0,t._loadImageFail(this)})},e.prototype._loadImageSucc=function(o){this.emit("done",o),this._commonLoadImageCall(o)},e.prototype._loadImageFail=function(o){this.emit("fail",o),this._commonLoadImageCall(o)},e.prototype._commonLoadImageCall=function(o){o.onload=o.onerror=null,this._loadImage()},t.exports=e});
;define("disk-share:widget/pageModule/list/list-view-empty/list-view-empty.js",function(e,o,t){var i=e("base:widget/libs/jquerypacket.js"),d=e("base:widget/hash/hash.js"),n={dom:{module:".KPDwCE",searchEmptyModule:".empty-search-container",viewEmptyModule:".module-list-view-empty",noResultTcode:'a[node-type~="nyeBePD"]',noResultTcodePic:'div[node-type~="asowjN8"]',noResultTcodeClose:'a[node-type~="ikoBKkX"]',newDirBox:'input[node-type~="amYQN3"]',newDir:'div[node-type~="lbvBERy"]'},bindEvent:function(){var e=!1,o=i(n.dom.module);o.delegate(n.dom.noResultTcode,"mouseover",function(){i(n.dom.noResultTcodePic).show()}),o.delegate(n.dom.noResultTcodePic,"mouseover",function(){e=!0}),o.delegate(n.dom.noResultTcodePic,"mouseleave",function(){i(n.dom.noResultTcodePic).hide()}),o.delegate(n.dom.noResultTcode,"mouseout",function(){setTimeout(function(){e||(i(n.dom.noResultTcodePic).hide(),e=!1)},200)}),o.delegate(n.dom.noResultTcodeClose,"click",function(){i(n.dom.noResultTcodePic).hide()})},tmpl:{emptyViewContainer:'<div class="clearfix module-list-view-empty" style="" node-type="twAMk8"><div class="list-view-empty-header"><div class="bar global-clearfix"><span class="chk"></span></div></div><div class="no-data"><div class="img"></div><p>没有数据...</p></div></div>',emptySearchContainer:'<div class="empty-search-container"><div class="search-empty-box"></div></div>'},util:{render:function(){i(n.tmpl.emptyViewContainer).appendTo(n.dom.module),i(n.tmpl.emptySearchContainer).appendTo(n.dom.module)}},init:function(){n.bindEvent()}};i(document).ready(function(){n.init()});var s={emptyView:function(){var e=d.get("search/key");return e?n.tmpl.emptySearchContainer:n.tmpl.emptyViewContainer}};t.exports=s});
;define("disk-share:widget/pageModule/list/grid-view/grid-view-builder.js",function(e,t,i){function a(e){k.gridViewContainer||(k.gridViewContainer=e.$gridViewContainer.find(".BNfIyPb")),k.itemHeight||(k.itemHeight=e.getCurrentView().itemHeight);var t=0;if(k.itemHeight>0){var i=k.gridViewContainer.scrollTop();t=Math.max(parseInt(i/k.itemHeight,10)-2,0)}k.load(t)}var s=e("base:widget/libs/jquerypacket.js"),n=e("base:widget/libs/underscore.js"),r=e("base:widget/historyManager/historyManager.js"),l=e("disk-share:widget/system/util/util.js"),o=(e("disk-share:widget/system/util/ab.js"),e("system-core:context/context.js").instanceForSystem),c=e("disk-share:widget/system/fileOperate/fileOperate.js"),d=e("disk-share:widget/system/util/lazyLoadImage.js"),m=o.message,h=1048576,u=10*h,g=location.pathname.indexOf("/link/")>-1,p=4===+window.locals.get("sharetype"),f={LIST:"list",CATEGORY:"category",SEARCHPATH:"searchPath",SEARCHGLOBAL:"searchGlobal",SEARCH:"search"},v=function(){var e=document.createElement("dd");e.className="g-clearfix";var t=[];t.push('<div class="cEefyz">'),t.push('<span node-type="EOGexf" class="EOGexf"></span>'),t.push('<div class="JS-fileicon" title="">'),t.push('<img class="thumb"/>'),t.push('<span class="playIcon"></span>'),t.push("</div>"),t.push('<div class="file-name">'),t.push('<a node-type="bzinAgrR" class="filename" href="javascript:void(0);" title=""></a>'),t.push("</div>"),t.push("</div>");for(var i=[],a=k.columnsCount=this.getColumnsCount(),s=0;a>s;s++)i.push(t.join(""));return e.innerHTML=i.join(""),e},C=null,w=null,b=function(){C=null,w=null},y=function(e,t,i){var a,n,d=t;null==d&&(d=this.buildView(e,t,i));for(var h,v=this.getGroupElementsData(),b=v[i],y=s(d),I=this,S=this.getColumnsCount(),L=y.find(".cEefyz"),A=0;A<b.length;A++){if(h=b[A],a=L[A],n=s(a),a.style.display="block",a.setAttribute("_position",i),this.isAllItemChecked()||this.isItemChecked(i*S+A)?n.addClass("JS-item-active"):n.removeClass("JS-item-active hover-item"),!a.getAttribute("_installed")){var _,H;n.mouseover(function(){if(_=(new Date).getTime(),I.parent.isLocked())return!1;var e=s(this);return e.addClass("hover-item"),!1}).mouseout(function(){if(I.parent.isLocked())return!1;var e=s(this);return e.removeClass("hover-item"),H=(new Date).getTime(),o.log.send({name:"gridListHover",value:H-_}),!1}),n.bind("click dblclick",function(e){var t=(new Date).getTime();if(I.parent.isLocked())return!1;var i,a=s(this),n=parseInt(a.attr("_position"),10),d=a.index(),h=n*S+d,v=I.getElementsData()[h],b=I.isItemChecked(h),y=!1;if(e.shiftKey){var k=I.getCheckedIndexs(),L=k[0];0===L||L||(L=h),I.setItemsChecked(!1);var A=L,_=h;if(_>A)for(;_>=A;)I.setItemChecked(A,!0),A++;else if(A>_)for(A=k[k.length-1];A>=_;)I.setItemChecked(A,!0),A--;else I.setItemChecked(A,!0);I.requestLayout()}else{if(!e.ctrlKey){if(1!==window.locals.get("loginstate")&&2===v.category&&v.size<52428800)return l.makePreviewMusicLogin(),!1;if(v.isdir)return I.setItemsChecked(!1),filename=v.server_filename,"string"==typeof v.path&&0===v.path.indexOf("/")&&(v.path=v.path.substr(1,v.path.length)),I.parent.cache.cacheName===f.SEARCH||I.parent.cache.cacheName===f.SEARCHGLOBAL||I.parent.cache.cacheName===f.SEARCHPATH?r.assignUrlHash("list/path="+encodeURIComponent(v.path)+"&vmode="+r.getCurrentParams().vmode):v.parent_path?I.parent.addHistory(v.path,v.server_filename,decodeURIComponent(v.parent_path)):I.parent.addHistory(v.server_filename,v.server_filename),!1;var H=a.data("plugin"),x=c.getInfo("/unknown.mp3",0,!1,!1,!1,0).plugin;if(H&&H.length)return g||p||H!==x?(m.trigger("plugin:"+H,{filesList:[v],limitTxtSize:u}),!1):(m.trigger("plugin:"+x,{filesList:[v],isNewShare:1}),!1);i=I.getCheckedIndexs(),i.length>0&&(b===!1||b&&i.length>1)&&(I.setItemsChecked(!1),y=!0),b&&i.length>1&&(b=!1)}C=h,w=null,I.setItemChecked(h,!b),y?I.requestLayout():b?a.removeClass("JS-item-active"):a.addClass("JS-item-active")}var J=(new Date).getTime();return o.log.send({name:"gridListSingleSel",value:J-t}),!1}).delegate(".EOGexf","click",function(e){var t=(new Date).getTime();if(I.parent.isLocked())return!1;e.stopPropagation();var i=s(this).closest(".cEefyz"),a=parseInt(i.attr("_position"),10),n=i.index(),r=a*S+n,l=I.isItemChecked(r);I.setItemChecked(r,!l),l?i.removeClass("JS-item-active"):i.addClass("JS-item-active");var c=(new Date).getTime();o.log.send({name:"gridListMultiSel",value:c-t})}).delegate(".EOGexf","dblclick",function(e){e.stopPropagation()}),a.setAttribute("_installed",1)}var x=c.getInfo(h.path,h.isdir,!1,!1,!1,h.wpfile);n.find(".playIcon").remove(),"fileicon-large-video"===x.largeIcon&&(n.find(".JS-fileicon").append('<span class="playIcon"></span>'),n.mouseenter(function(){s(this).find(".playIcon").show()}).mouseleave(function(){s(this).find(".playIcon").hide()})),n.find(".JS-fileicon").attr('class', 'JS-fileicon '+x.largeIcon),h.isdir||x.plugin?(n.addClass("open-enable"),n.data("plugin",x.plugin)):(n.removeClass("open-enable"),n.data("plugin",""));var J,T,j=n.find(".JS-fileicon img");j.removeAttr("src"),4!==h.category&&h.thumbs&&h.thumbs.url1?(T=h.thumbs.url1.replace("size=c140_u90","size=c180_u194"),(J=k.loadedImgMap[T])?(j.removeAttr("_src").attr("src",J.src).css({left:J.left,top:J.top,visibility:"visible"}),j.parent().attr('class', 'JS-fileicon')):j.removeAttr("src").attr("_src",T).css("visibility","hidden")):j.removeAttr("_src").removeAttr("src").css("visibility","hidden"),1===+h.wpfile&&(x.name=x.name.replace(/\.(\w*?)$/i,"")),n.find(".filename").html(x.name).attr("title",x.fileName).data("filename",h.server_name)}if(b.length!=S)for(var P=b.length;S>P;++P)L[P].style.display="none";return d},k={columnsCount:0,gridViewContainer:null,itemHeight:0,lazyLoadImagePlugin:new d,loadedImgMap:{},init:function(){this.lazyLoadImagePlugin.on("done",n.bind(this.imgLoadedSuccessFunc,this)),this.lazyLoadImagePlugin.on("fail",n.bind(this.imgLoadedFailFunc,this))},imgLoadedSuccessFunc:function(e,t){e=s(e);var i,a=0,n=0,r=e.width(),l=e.height();r>0&&l>0&&(a=(90-r)/2,n=(92-l)/2),i={left:a,top:n,visibility:"visible"},e.css(i).removeAttr("_src");var c=e.attr("src");if(!c)return!1;var d=c.replace(/http:\/\/d[0-9]\./,"http://d.");i.src=c,this.loadedImgMap[d]=i,e.parent().attr('class', 'JS-fileicon'),o.log.send({name:"s_imgLoad",value:t})},imgLoadedFailFunc:function(e){e=s(e),e.removeAttr("src"),e.removeAttr("_src")},checkCanLoad:function(e){for(var t=0,i=k.gridViewContainer,a=i.scrollTop(),s=i.height();e&&-1===e.className.indexOf("cEefyz");)e=e.parentNode,t+=e.offsetTop;return a-100>t?-1:t>a+s?0:1},load:function(e){for(var t=k.gridViewContainer,i=e?t.find("dd:gt("+e+")").find(".thumb[_src]"):t.find(".thumb[_src]"),a=[],s=0,n=i.length;n>s;s++){var r=i[s];if(!r)break;var l=this.checkCanLoad(r);if(0===l)break;-1!==l?1===l&&([].push.apply(a,[].slice.call(i,s,s+this.columnsCount)),s=s+this.columnsCount-1):s=s+this.columnsCount-1}this.lazyLoadImagePlugin.changeImages(a)}};k.init();var I=-1,S=0,L=1e3,A=/vmode=grid/.test(location.hash);i.exports={getView:y,buildView:v,onScroll:n.debounce(function(){if(A)return void(A=!1);var e=this.parent,t=n.now(),i=S;clearTimeout(I),S=t,t-i>L?a(e):I=setTimeout(a,L,e)},350),clear:b}});
;define("disk-share:widget/pageModule/list/list-view/list-view-builder.js",function(e,t,i){function a(){return d.Broker.getButtonBroker("shareList")}var s=e("base:widget/libs/jquerypacket.js"),n=e("base:widget/historyManager/historyManager.js"),r=e("base:widget/tools/tools.js"),l=e("base:widget/tools/service/tools.date.js"),o=e("base:widget/tools/service/tools.format.js"),c=e("base:widget/tools/service/tools.path.js"),h=e("disk-share:widget/system/util/util.js"),d=(e("disk-share:widget/system/util/ab.js"),e("system-core:context/context.js").instanceForSystem),g=e("disk-share:widget/system/fileOperate/fileOperate.js"),m=e("disk-share:widget/system/util/elinkThemeRender.js"),p=d.message,f=1048576,v=10*f,u=location.pathname.indexOf("/link/")>-1,w=4===+window.locals.get("sharetype");d.Broker.initButtonBroker({name:"shareList",config:{limit:3,container:s("<div>")}});var b={LIST:"list",CATEGORY:"category",SEARCHPATH:"searchPath",SEARCHGLOBAL:"searchGlobal",SEARCH:"search"},k=function(){var e=this.parent.listHeader.config.columns||[{width:60},{width:16},{width:23}],t=document.createElement("dd");return t.className="g-clearfix AuPKyz",t.innerHTML='<span node-type="EOGexf" class="EOGexf"></span><div class="JS-fileicon"></div><div class="file-name" style="width:'+e[0].width+'%"><div class="text"><a href="javascript:void(0);" class="filename"></a></div><div class="sybxeNb"></div></div><div class="file-size" style="width:'+e[1].width+'%">-</div>'+(e[2]?'<div class="ctime" style="width:'+e[2].width+'%"></div>':"")+'<div class="path-info" style="width:'+(e[3]?e[3].width-1:0)+'%"><span class="search-feild" node-type="lxtgAd9Q"></span></div>',t},C=null,y=null,_=function(){C=null,y=null},S=function(e,t){if(e&&0!==e.length)for(var i=0;i<e.length;i++){var a=s(e[i]),n=a.data("excludedir");if(n){var r=t.path.substring(1);-1!==n.indexOf(r)?a.addClass("g-disabled"):a.removeClass("g-disabled")}var l=a.data("includetype");if(l){var o=c.getFileCategory(t.path);-1===l.indexOf(o)?a.hide():a.show()}}},x=function(e){var t=/^[.,?\]})'";:`~!%&*|>，﹐。？、】）·！……’”；：]*/;if(e.highlighting&&e.highlighting.abstract){e.highlighting.abstractFixed=e.highlighting.abstract,e.highlighting.abstract=e.highlighting.abstract.replace(/\n+\s*\n/g,"\n"),e.highlighting.abstract=e.highlighting.abstract.replace(t,"");var i=e.highlighting.abstract;if(pos=i.search(/<em>/),pos>36){var a=pos-12;i=i.slice(a,i.length),e.highlighting.abstractFixed=i}e.highlighting.abstractFixed=e.highlighting.abstractFixed.replace(t,"")}return e},A=function(e,t){var i=t.length;if(!i)return!0;for(var a=e.filesType,s=a.split(","),n="",l=0,o=i;o>l;l++){var c=t[l];if(n=r.getFileCategory(c.server_filename||c.file_name),!n)return!1;if(~s.indexOf(n,s))return!0}return!1},L=function(e,t,i){var r=t;null==r&&(r=this.buildView(e,t,i));var c=this.getElementDataByPosition(i),f=s(r),k=this.parent.cache.cacheName===b.SEARCHGLOBAL,_=this;if(k&&(f.addClass("list-view-vip-search"),c=x(c)),r.setAttribute("_position",i),r.setAttribute("_cmd_installed",1),this.isAllItemChecked()||this.isItemChecked(i)?f.addClass("JS-item-active"):f.removeClass("JS-item-active hover-item"),!r.getAttribute("_installed")){var L,H;f.mouseenter(function(){if(L=(new Date).getTime(),_.parent.isLocked())return!1;var e=s(this),t=e.find(".sybxeNb");m.getTransferAndDownloadStatus(function(t){t.cantTransfer||t.cantDownload||e.addClass("hover-item")}),""===t.html()&&(t.html(a().getContent()),d.addIconFont&&d.message.trigger("addIcon",t[0]));var i=s(".tools-share-unzip");return A({filesType:"rar,zip",filesTypeStrongMatch:!0},[c])?i.css("display","inline-block"):i.css("display","none"),!1}).mouseleave(function(){if(_.parent.isLocked())return!1;var e=s(this);return e.removeClass("hover-item"),e.find(".g-dropdown-button").removeClass("button-open"),H=(new Date).getTime(),d.log.send({name:"listListHover",value:H-L}),!1}),f.click(function(e){var t=(new Date).getTime();if(_.parent.isLocked())return!1;var i=parseInt(this.getAttribute("_position"),10),a=_.isItemChecked(i),n=_.getCheckedIndexs(),r=e.ctrlKey||e.metaKey,l=s(this);if(e.shiftKey){var o=Math.min(i,C),c=Math.max(i,C),h=l,g=!1;if("number"==typeof y){var m=Math.min(i,y),p=Math.max(i,y);for(g=m===i;p>=m;)_.setItemChecked(m,!1),h.length>0&&h.removeClass("JS-item-active"),h=g?h.next(".AuPKyz"):h.prev(".AuPKyz"),m++}for(h=l,g=o===i;c>=o;)_.setItemChecked(o,!0),h.length>0&&h.addClass("JS-item-active"),h=g?h.next(".AuPKyz"):h.prev(".AuPKyz"),o++;y=i}else C=i,y=null,r&&(n.length>0&&(a===!1||a&&n.length>1)&&(_.setItemsChecked(!1),l.siblings(".AuPKyz").removeClass("JS-item-active")),a&&n.length>1&&(a=!1)),_.setItemChecked(i,!a),a?l.removeClass("JS-item-active"):l.addClass("JS-item-active");var f=(new Date).getTime();d.log.send({name:"listListSingleSel",value:f-t})}),f.delegate(".filename","click",function(){if(_.parent.isLocked())return!1;var e=parseInt(s(this).closest(".AuPKyz")[0].getAttribute("_position"),10),t=_.getElementDataByPosition(e);if(t.isdir)d.log.send({name:"web_share_click_list_dir",value:"外链列表页点击文件夹"}),"string"==typeof t.path&&0===t.path.indexOf("/")&&(t.path=t.path.substr(1,t.path.length)),_.parent.cache.cacheName===b.SEARCH||_.parent.cache.cacheName===b.SEARCHGLOBAL||_.parent.cache.cacheName===b.SEARCHPATH?n.assignUrlHash("list/path="+encodeURIComponent(t.path)+"&vmode="+n.getCurrentParams().vmode):t.parent_path?_.parent.addHistory(t.path,t.server_filename,decodeURIComponent(t.parent_path)):_.parent.addHistory(t.server_filename,t.server_filename);else{d.log.send({name:"web_share_click_list_file",value:{value:"外链列表页点击文件",category:t.category}});var i=t.path?t.path.match(/\.[a-zA-Z0-9]+$/):["unkown"],a=i?i[0]:"unkown";if(d.log.send({name:"web_share_list_preview_content",value:{value:"外链列表预览内容",from:a,path:t.path,fs_id:t.fs_id,md5:t.md5,from_uk:window.locals.get("share_uk")}}),window.locals.get("sharetype",function(e){"4"===String(e)&&d.log.send({type:"web_list_click_limitShare",value:"密享外链列表页预览内容总数"})}),1!==window.locals.get("loginstate")&&2===t.category&&t.size<52428800)return h.makePreviewMusicLogin(),!1;var r=f.data("plugin"),l=g.getInfo("/unknown.mp3",0,!0,!1,!1,0).plugin;if(!r||!r.length)return!0;if(!u&&!w&&r===l)return p.trigger("plugin:"+l,{filesList:[t],isNewShare:1}),!1;p.trigger("plugin:"+r,{filesList:[t],limitTxtSize:v})}return!1}).delegate(".g-button","click",function(){if(_.parent.isLocked())return!1;var e=parseInt(s(this).closest(".AuPKyz")[0].getAttribute("_position"),10),t=_.getElementDataByPosition(e),i=s(this).next(".menu");if(i.length){var n=i.find(".g-button-menu");return S(n,t),s(this).closest(".g-dropdown-button").toggleClass("button-open"),void(i.offset().top>s(window).height()-i.outerHeight()?i.addClass("more-list-up"):i.removeClass("more-list-up"))}var r=s(this).index()-1;a().triggerClick(r,{filesList:[t],position:[e]})}).delegate(".g-button-menu","click",function(){if(_.parent.isLocked())return!1;var e=parseInt(s(this).closest(".AuPKyz")[0].getAttribute("_position"),10),t=_.getElementDataByPosition(e),i=s(this).index();a().triggerClick(i,{filesList:[t],position:[e]}),s(this).closest(".g-dropdown-button").removeClass("button-open")}).delegate(".sybxeNb","click",function(e){return _.parent.isLocked()?!1:void e.stopPropagation()}).delegate(".EOGexf","click",function(e){var t=(new Date).getTime();if(_.parent.isLocked())return!1;d.log.send({name:"web_share_click_list_select",value:"外链列表页点击选择"}),e.stopPropagation();var i=s(this).closest(".AuPKyz"),a=parseInt(i.attr("_position"),10),n=_.isItemChecked(a);_.setItemChecked(a,!n),n?i.removeClass("JS-item-active"):i.addClass("JS-item-active");var r=(new Date).getTime();d.log.send({name:"listListMultiSel",value:r-t})}).delegate(".EOGexf","dblclick",function(e){e.stopPropagation()}).delegate(".search-feild","click",function(e){e.stopPropagation(),n.assignUrlHash("list/path="+encodeURIComponent(s(e.target).data("path"))+"&vmode="+n.getCurrentParams().vmode)}),f.bind("dblclick",function(){if(_.parent.isLocked())return!1;var e=parseInt(s(this)[0].getAttribute("_position"),10),t=_.getElementDataByPosition(e);if(t.isdir)"string"==typeof t.path&&0===t.path.indexOf("/")&&(t.path=t.path.substr(1,t.path.length)),_.parent.cache.cacheName===b.SEARCH||_.parent.cache.cacheName===b.SEARCHGLOBAL||_.parent.cache.cacheName===b.SEARCHPATH?n.assignUrlHash("list/path="+encodeURIComponent(t.path)+"&vmode="+n.getCurrentParams().vmode):t.parent_path?_.parent.addHistory(t.path,t.server_filename,decodeURIComponent(t.parent_path)):_.parent.addHistory(t.server_filename,t.server_filename);else{var i=f.data("plugin");if(!i||!i.length)return!0;p.trigger("plugin:"+i,{filesList:[t]})}return!1}),r.setAttribute("_installed",1)}var I=g.getInfo(c.path,c.isdir,!0,!1,!1,c.wpfile);if(k){if(1==c.category||3==c.category){var J=c.thumbs.url1.replace(/size=.*&/,"size=c50_u50&").replace(/&quality=100/,"&quality=80");f.find(".JS-fileicon").css("background","url("+J+") 50% 50% no-repeat")}else f.find(".JS-fileicon").removeAttr("style");f.find(".JS-fileicon").attr('class', 'JS-fileicon '+I.middleIcon)}else f.find(".JS-fileicon").attr('class', 'JS-fileicon '+I.smallIcon);if(c.isdir||I.plugin?(f.addClass("open-enable"),f.data("plugin",I.plugin)):(f.removeClass("open-enable"),f.data("plugin","")),k&&c.highlighting.filename?(1===+c.wpfile&&(c.highlighting.name=c.highlighting.replace(/\.(\w*?)$/i,"")),f.find(".filename").html(c.highlighting.filename).attr("title",I.fileName).data("filename",c.server_filename)):(1===+c.wpfile&&(I.name=I.name.replace(/\.(\w*?)$/i,"")),f.find(".filename").html(I.name).attr("title",I.fileName).data("filename",c.server_filename)),k){var E="";E+=c.highlighting&&c.highlighting.abstract?'<div node-type="hhlnwpRm" class="name name-desc" title=" '+c.highlighting.abstract.replace(/\<em\>/g,"").replace(/\<\/em\>/g,"")+'">':'<div node-type="hhlnwpRm" class="name name-desc" title="">',E+='<span class="name-text-wrapper">',E+=c.highlighting.abstractFixed?'<span node-type="yzOBbsb" class="yzOBbsb">'+c.highlighting.abstractFixed+"</span>":'<span node-type="yzOBbsb" class="yzOBbsb">'+(c.highlighting.abstract||"")+"</span>",E+="</span></div>",0===f.find(".name-desc").length?f.find(".file-name").append(E):f.find(".name-desc").html(E)}if(f.find(".file-size").text(c.isdir?"-":1===+c.wpfile?"-":o.toFriendlyFileSize(c.size)),c.server_mtime||(c.server_mtime="-"),f.find(".ctime").text("-"===c.server_mtime?c.server_mtime:l.parseDate(c.server_mtime)),this.parent.cache.cacheName===b.SEARCH||this.parent.cache.cacheName===b.SEARCHGLOBAL||this.parent.cache.cacheName===b.SEARCHPATH){var R=c.path.split("/"),T="",P="";2===R.length?(T="/",P="全部文件"):(T=R.slice(0,R.length-1).join("/"),P=R[R.length-2]),f.find(".search-feild").data("path",T).attr("title",P).text(P)}return r};i.exports={getView:L,buildView:k,clear:_}});
;define("disk-share:widget/pageModule/list/share-multi.js",function(e){var s=e("system-core:context/context.js").instanceForSystem;s.message.trigger("share-person-info","show-intro"),e("disk-share:widget/system/util/adPlatform/adPlatform.js").getAdResoucre({list:[{id:"web-sharelinkpic",w:200,h:200},{id:"web-sharemultibanner",w:960,h:60},{id:"web-sharelinkrepeat",w:1,h:1}]})});
;define("disk-share:widget/pageModule/toolbar/toolbar.js",function(i){var e=i("base:widget/libs/jquerypacket.js"),t=i("system-core:context/context.js").instanceForSystem,o=t.message,d=e(".module-toolbar"),s={listGridSwitch:".list-grid-switch",listSwitch:".list-switch",gridSwitch:".grid-switch",prevDom:"div.prev-dom",afterDom:"div.after-dom",defaultDom:"div.default-dom",userDom:"div.user-dom",timeLineDom:"div.yun-pic-bar"};t.Broker.initButtonBroker({name:"shareTools",config:{container:d.find(".bar"),limit:4}});var n=function(i){null!==localStorage&&localStorage.setItem("chooseviewtype",i)};d.on("click",s.listSwitch,function(){if(!e(this).parent().hasClass("list-switched-on")){var i={type:"list"};n("list"),o.trigger("system-show-view-mode",i)}}),d.on("click",s.gridSwitch,function(){if(!e(this).parent().hasClass("grid-switched-on")){var i={type:"grid"};n("grid"),o.trigger("system-show-view-mode",i)}}),o.listen("system-update-view-mode",function(i){var e=d.find(s.listGridSwitch);"list"===i.type?(e.addClass("list-switched-on").removeClass("grid-switched-on"),e.find("a[node-type=rxaw6Dq]").hide(),e.find("a[node-type=jvkrYnJW]").show()):(e.removeClass("list-switched-on").addClass("grid-switched-on"),e.find("a[node-type=rxaw6Dq]").show(),e.find("a[node-type=jvkrYnJW]").hide())});var r=!1,a=!1;t.extend({toolbar:{afterDom:function(i,t){if(i){if(a)return;t===!0&&(a=!0),d.find(s.afterDom).html("").append(i).show()}else i===!1?(d.find(s.afterDom).html(""),a=!1):d.find(s.afterDom).hide();e(window).trigger("resize")},prevDom:function(i,t){if(i){if(r)return;t===!0&&(r=!0),d.find(s.prevDom).html("").append(i).show()}else i===!1?(d.find(s.prevDom).html(""),r=!1):d.find(s.prevDom).hide();e(window).trigger("resize")},showDefault:function(){d.find(s.userDom).hide(),d.find(s.defaultDom).show(),d.find(s.prevDom).children().length&&d.find(s.prevDom).show(),d.find(s.afterDom).children().length&&d.find(s.afterDom).show(),d.find(s.timeLineDom).hide(),d.removeClass("module-toolbar-hackbg")},setDom:function(i){d.find(s.defaultDom).hide(),d.find(s.prevDom).hide(),d.find(s.afterDom).hide(),d.find(s.timeLineDom).hide(),d.find(s.userDom).html("").append(i).show(),d.removeClass("module-toolbar-hackbg"),e(window).trigger("resize")},showTimelineDom:function(){d.find(s.defaultDom).hide(),d.find(s.prevDom).hide(),d.find(s.afterDom).hide(),d.find(s.userDom).hide(),d.find(s.timeLineDom).show(),d.addClass("module-toolbar-hackbg"),e(window).trigger("resize")}}})});
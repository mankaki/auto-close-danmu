// ==UserScript==
// @name         芒果TV网页版弹幕增强
// @namespace    http://tampermonkey.net/
// @version      2.3.0
// @description  芒果TV弹幕增强脚本：自动关闭弹幕、快捷键操作（D键切换弹幕/F键全屏）、高级屏蔽词设置（不限数量、支持正则表达式、导入导出功能、本地持久化存储）、视频列表名称自动换行、播放列表Tab记忆与跨月自动连播
// @author       mankaki
// @match        *://www.mgtv.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mgtv.com
// @grant        none
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/mankaki/auto-close-danmu/main/auto-close-danmu.user.js
// @updateURL    https://raw.githubusercontent.com/mankaki/auto-close-danmu/main/auto-close-danmu.user.js
// ==/UserScript==

(function () {
    'use strict';

    function loadAutoCloseDanmuSetting() {
        try {
            const storedValue = localStorage.getItem('autoCloseDanmu');
            return storedValue === null ? true : JSON.parse(storedValue);
        } catch (e) {
            return true;
        }
    }

    let autoCloseDanmu = loadAutoCloseDanmuSetting();
    let blocklistManagerInstance = null;
    let lastUrl = window.location.href;
    let isManualIntervention = false; // 标记用户本集是否手动干预过（手动开启或关闭）
    let lastManualTime = 0; // 上次手动操作的时间戳，用于冷却锁定
    let isScriptClicking = false; // 标记是否是脚本触发的点击，用于识别用户手动操作

    function clearOldTooltips() {
        const tooltipButtons = document.querySelectorAll('[data-mgtv-tooltip-attached]');
        tooltipButtons.forEach(button => {
            if (button._tooltipCleanup) {
                button._tooltipCleanup();
            } else {
                delete button.dataset.mgtvTooltipAttached;
            }
        });

        const oldTooltips = document.querySelectorAll('.mgtv-custom-tooltip');
        oldTooltips.forEach(t => t.remove());
    }

    function createTooltip(text, direction = 'top') {
        const tooltip = document.createElement('div');
        tooltip.className = 'mgtv-custom-tooltip';
        tooltip.innerText = text;
        tooltip.style.position = 'fixed';
        tooltip.style.padding = '6px 10px';
        tooltip.style.fontSize = '13px';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        tooltip.style.color = '#fff';
        tooltip.style.borderRadius = '6px';
        tooltip.style.whiteSpace = 'nowrap';
        tooltip.style.zIndex = '10000';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.transition = 'opacity 0.2s ease';
        tooltip.style.opacity = '0';

        if (direction === 'left') {
            tooltip.style.transform = 'translate(-105%, -50%)';
        } else {
            tooltip.style.transform = 'translate(-50%, -120%)';
        }

        return tooltip;
    }

    function addTooltip(button, text, direction) {
        if (!button) return;
        if (button._tooltipCleanup) {
            button._tooltipCleanup();
        }
        if (button.dataset.mgtvTooltipAttached) return;
        button.dataset.mgtvTooltipAttached = 'true';

        const tooltip = createTooltip(text, direction);
        document.body.appendChild(tooltip);

        const handleMouseEnter = () => {
            // 全屏模式下，必须将 Tooltip 移动到全屏元素内部，否则会被遮挡
            const container = document.fullscreenElement || document.body;
            if (tooltip.parentNode !== container) {
                container.appendChild(tooltip);
            }
            tooltip.style.zIndex = '2147483647';

            const rect = button.getBoundingClientRect();
            if (direction === 'left') {
                tooltip.style.left = `${rect.left}px`;
                tooltip.style.top = `${rect.top + rect.height / 2}px`;
            } else {
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
                tooltip.style.top = `${rect.top}px`;
            }
            tooltip.style.opacity = '1';
        };

        const handleMouseLeave = () => {
            tooltip.style.opacity = '0';
        };

        button.addEventListener('mouseenter', handleMouseEnter);
        button.addEventListener('mouseleave', handleMouseLeave);
        button._tooltipCleanup = () => {
            button.removeEventListener('mouseenter', handleMouseEnter);
            button.removeEventListener('mouseleave', handleMouseLeave);
            tooltip.remove();
            delete button.dataset.mgtvTooltipAttached;
            button._tooltipCleanup = null;
        };
    }

    function createToggleIconButton() {
        const button = document.createElement('div');
        button.id = 'autoDanmuToggleBtn';
        button.style.position = 'fixed';
        button.style.bottom = '9px'; // 距离底部9px
        button.style.right = '0'; // 紧贴右边
        button.style.zIndex = '9999';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.width = '52px';
        button.style.height = '40px';
        button.style.borderTopLeftRadius = '20px';
        button.style.borderBottomLeftRadius = '20px';
        button.style.borderTopRightRadius = '0';
        button.style.borderBottomRightRadius = '0';
        button.style.backgroundColor = '#fff';
        button.style.boxShadow = '-2px 2px 8px rgba(0, 0, 0, 0.1)';
        button.style.cursor = 'pointer';
        button.style.transition = 'background-color 0.3s';

        // 图标 img
        const icon = document.createElement('img');
        icon.style.width = '24px';
        icon.style.height = '24px';
        icon.style.marginRight = '-4px'; // 让图标更靠右，减少内边距空隙
        icon.src = autoCloseDanmu
            ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik02IDE4aDEyYzMuMzExIDAgNi0yLjY4OSA2LTZzLTIuNjg5LTYtNi02aC0xMi4wMzljLTMuMjkzLjAyMS01Ljk2MSAyLjcwMS01Ljk2MSA2IDAgMy4zMTEgMi42ODggNiA2IDZ6bTEyLTEwYy0yLjIwOCAwLTQgMS43OTItNCA0czEuNzkyIDQgNCA0IDQtMS43OTIgNC00LTEuNzkyLTQtNC00eiIvPjwvc3ZnPg=='
            : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0xOCAxOGgtMTJjLTMuMzExIDAtNi0yLjY4OS02LTZzMi42ODktNiA2LTZoMTIuMDM5YzMuMjkzLjAyMSA1Ljk2MSAyLjcwMSA1Ljk2MSA2IDAgMy4zMTEtMi42ODggNi02IDZ6bTAtMTBoLTEyYy0yLjIwOCAwLTQgMS43OTItNCA0czEuNzkyIDQgNCA0aDEyYzIuMjA4IDAgNC0xLjc5MiA0LTQgMC0yLjE5OS0xLjc3OC0zLjk4Ni0zLjk3NC00aC0uMDI2em0tMTIgMWMxLjY1NiAwIDMgMS4zNDQgMyAzcy0xLjM0NCAzLTMgMy0zLTEuMzQ0LTMtMyAxLjM0NC0zIDMtM3oiLz48L3N2Zz4=';

        button.appendChild(icon);

        button.addEventListener('click', () => {
            autoCloseDanmu = !autoCloseDanmu;
            localStorage.setItem('autoCloseDanmu', JSON.stringify(autoCloseDanmu));
            icon.src = autoCloseDanmu
                ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik02IDE4aDEyYzMuMzExIDAgNi0yLjY4OSA2LTZzLTIuNjg5LTYtNi02aC0xMi4wMzljLTMuMjkzLjAyMS01Ljk2MSAyLjcwMS01Ljk2MSA2IDAgMy4zMTEgMi42ODggNiA2IDZ6bTEyLTEwYy0yLjIwOCAwLTQgMS43OTItNCA0czEuNzkyIDQgNCA0IDQtMS43OTIgNC00LTEuNzkyLTQtNC00eiIvPjwvc3ZnPg=='
                : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0xOCAxOGgtMTJjLTMuMzExIDAtNi0yLjY4OS02LTZzMi42ODktNiA2LTZoMTIuMDM5YzMuMjkzLjAyMSA1Ljk2MSAyLjcwMSA1Ljk2MSA2IDAgMy4zMTEtMi42ODggNi02IDZ6bTAtMTBoLTEyYy0yLjIwOCAwLTQgMS43OTItNCA0czEuNzkyIDQgNCA0aDEyYzIuMjA4IDAgNC0xLjc5MiA0LTQgMC0yLjE5OS0xLjc3OC0zLjk4Ni0zLjk3NC00aC0uMDI2em0tMTIgMWMxLjY1NiAwIDMgMS4zNDQgMyAzcy0xLjM0NCAzLTMgMy0zLTEuMzQ0LTMtMyAxLjM0NC0zIDMtM3oiLz48L3N2Zz4=';
        });

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#ff5f00';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#fff';
        });

        document.body.appendChild(button);

        // 左侧显示 tooltip
        addTooltip(button, '💡 是否自动关闭弹幕', 'left');
    }

    function closeDanmu() {
        if (!autoCloseDanmu) return;
        // 如果用户本集手动操作过，脚本不再干预
        if (isManualIntervention) return;

        // v2.1.2：如果 5 秒内进行过手动操作，坚决不进行自动关闭（防止竞速冲突）
        if (Date.now() - lastManualTime < 5000) return;

        const danmuBtn = document.querySelector("._danmuSwitcher_1qow5_208") ||
            document.querySelector(".danmu-switch"); // 增加备选选择器

        if (danmuBtn) {
            const isOn = danmuBtn.classList.contains("_on_1qow5_238") ||
                danmuBtn.classList.contains("on") ||
                danmuBtn.getAttribute('aria-checked') === 'true';

            if (isOn) {
                // 如果是开启状态，执行关闭
                isScriptClicking = true;
                danmuBtn.click();
                isScriptClicking = false;
                // console.log("检测到弹幕开启，强制自动关闭 (v2.0.8)");
            }
        }
    }

    function toggleDanmu() {
        const btn = document.querySelector("._danmuSwitcher_1qow5_208") ||
            document.querySelector(".danmu-switch");
        if (btn) {
            isManualIntervention = true;
            lastManualTime = Date.now(); // 记录手动时间戳
            btn.click();
            console.log("快捷键切换弹幕，触发 5s 强制停火锁定");
        }
    }

    function isTyping() {
        const active = document.activeElement;
        const tagName = active.tagName;
        const isContentEditable = active.isContentEditable;
        const isTextbox = active.getAttribute('role') === 'textbox';
        // 增加对常见输入框 class 的检测（不区分大小写）
        const isInputClass = active.className && typeof active.className === 'string' && /input|textarea/i.test(active.className);
        return (tagName === 'INPUT' || tagName === 'TEXTAREA' || isContentEditable || isTextbox || isInputClass);
    }

    function toggleFullscreen() {
        // 尝试寻找全屏按钮点击（以同步UI状态）
        const fsBtn = document.querySelector('[title="全屏"]') ||
            document.querySelector('[title="退出全屏"]') ||
            document.querySelector('mango-icon[name="fullscreen"]'); // 猜测的选择器

        if (fsBtn) {
            fsBtn.click();
            console.log("切换全屏 (点击按钮)");
            return;
        }

        // 兜底：使用原生 API
        const player = document.querySelector('.mango-player') || document.body;
        if (!document.fullscreenElement) {
            if (player.requestFullscreen) {
                player.requestFullscreen();
            } else if (player.webkitRequestFullscreen) {
                player.webkitRequestFullscreen();
            }
            console.log("切换全屏 (原生API)");
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
            console.log("退出全屏 (原生API)");
        }
    }

    window.addEventListener('keydown', (e) => {
        // 如果正在输入法输入中，直接返回，防止误触
        if (e.isComposing || e.keyCode === 229) return;
        if (isTyping()) return; // 如果正在输入，不触发快捷键

        if (e.key === 'd' || e.key === 'D') {
            toggleDanmu();
        } else if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
        }
    });

    // 监听全局点击，识别用户对手动操作弹幕按钮的行为
    document.addEventListener('click', (e) => {
        if (isScriptClicking) return;

        // 检查点击目标是否是弹幕开关
        // v2.0.8 进一步收窄范围，仅监听特定的开关类名，避免误触
        const isDanmuBtn = e.target.closest("._danmuSwitcher_1qow5_208") ||
            e.target.closest(".danmu-switch");

        if (isDanmuBtn) {
            // 用户手动点击了开关，记录为手动干预及时间戳
            isManualIntervention = true;
            lastManualTime = Date.now();
            // console.log("检测到用户手动操作，触发 5s 强制停火锁定");
        }
    }, true);

    function addDanmuShortcutTooltip() {
        const danmuButtons = document.querySelectorAll("._danmuSwitcher_1qow5_208");
        danmuButtons.forEach(btn => {
            if (!btn || btn.dataset.mgtvTooltipAttached) return;
            // 使用默认上方 tooltip
            addTooltip(btn, "💡 按 D 键可开关弹幕", 'top');
        });
    }

    // 尝试修改全屏按钮 tooltip。去除 mouseover 监听，放入低频 interval 以节省性能
    function modifyFullscreenTooltip() {
        const contextNode = document.fullscreenElement || document.body;
        
        // 1. 尝试直接修改带有 title 属性的按钮
        const fsBtns = contextNode.querySelectorAll('[title="全屏"]');
        fsBtns.forEach(btn => {
            btn.title = '全屏 (F)';
        });

        // 2. 备用策略：保留查找“全屏”文本元素的逻辑
        const xpath = "//*[text()='全屏']";
        const result = document.evaluate(xpath, contextNode, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);

        for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i);
            // 检查元素是否可见 (offsetParent 不为 null 代表可见)
            if (node.offsetParent !== null) {
                const text = node.innerText.trim();
                if (text === '全屏') {
                    node.innerText = '全屏 (F)';
                }
            }
        }
    }

    // --- 视频列表名称自动换行 ---
    function injectEpisodeTitleWrapStyle() {
        if (document.getElementById('mgtv_episode_wrap_style')) return;
        const style = document.createElement('style');
        style.id = 'mgtv_episode_wrap_style';
        style.textContent = `
            span.name {
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: unset !important;
                word-break: break-word !important;
            }
        `;
        document.head.appendChild(style);
    }

    // --- 播放列表 Tab 记忆 & 跨月自动连播 ---
    function getMgtvCid() {
        const match = window.location.href.match(/\/b\/(\d+)\//);
        return match ? match[1] : null;
    }

    // 页面加载时强制切到"往期正片"
    let tabRestored = false;
    function restoreTab() {
        if (tabRestored) return;
        const cid = getMgtvCid();
        if (!cid) return;

        const tabs = document.querySelectorAll('.show-tabs .tab');
        if (!tabs.length) return;

        // 找到"往期正片"Tab
        let targetTab = null;
        for (let i = 0; i < tabs.length; i++) {
            const a = tabs[i].querySelector('a');
            if (a && a.textContent.trim() === '往期正片') {
                targetTab = tabs[i];
                break;
            }
        }
        if (!targetTab) return;

        // 如果已经在"往期正片"或"精彩花絮"，不切换
        const currentFocusA = document.querySelector('.show-tabs .tab.focus a');
        const currentText = currentFocusA ? currentFocusA.textContent.trim() : '';
        if (currentText === '往期正片' || currentText === '精彩花絮') { tabRestored = true; return; }

        // 尝试多种点击方式触发 Vue/框架事件
        const link = targetTab.querySelector('a');
        if (link) link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        targetTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        // 不设 tabRestored = true，下次轮询会再检查 focus 是否真正生效
    }

    // 跨月自动连播：监听视频结束事件，当前月份列表播完后切到下一个月
    let endedListenerAttached = false;
    let isLastInMonth = false; // 标记当前是否为本月最后一集

    function attachEndedListener() {
        if (endedListenerAttached) return;

        // 持续检测当前是否为本月最后一集
        setInterval(checkIfLastInMonth, 2000);

        // 核心策略：在最后一集即将结束前提前准备跨月切换，仅在目标列表就绪后再暂停当前视频
        document.addEventListener('timeupdate', (e) => {
            if (e.target.tagName !== 'VIDEO') return;

            const video = e.target;
            if (!video.duration || !isFinite(video.duration)) return;
            const remaining = video.duration - video.currentTime;
            const currentVideoId = getMgtvVideoId(window.location.href);
            const isOnPositiveTab = isPositiveTabActive();
            const hasPreparedCrossMonthTarget = crossMonthReadyVideoId === currentVideoId && !!crossMonthReadyTargetVid;
            const readyTargetLink = hasPreparedCrossMonthTarget ? getReadyTargetLink() : null;

            if (hasPreparedCrossMonthTarget && remaining < 1 && remaining > 0) {
                if (!isOnPositiveTab) {
                    crossMonthBlockAutoplayVideoId = null;
                    resetCrossMonthReadyState();
                    finishCrossMonthSwitch();
                    return;
                }
                if (!readyTargetLink) {
                    resetCrossMonthReadyState();
                    crossMonthSwitching = false;
                    if (!video.paused) {
                        handleCrossMonthPlay(video, currentVideoId);
                    }
                    return;
                }
                if (!video.paused) {
                    video.pause();
                }
                readyTargetLink.click();
                crossMonthFailedVideoId = null;
                crossMonthBlockAutoplayVideoId = null;
                resetCrossMonthReadyState();
                finishCrossMonthSwitch();
                return;
            }

            if (!isOnPositiveTab) {
                if (crossMonthBlockAutoplayVideoId === currentVideoId || hasPreparedCrossMonthTarget) {
                    crossMonthBlockAutoplayVideoId = null;
                    resetCrossMonthReadyState();
                    finishCrossMonthSwitch();
                }
                return;
            }

            if (crossMonthBlockAutoplayVideoId === currentVideoId && remaining < 1 && remaining > 0 && !video.paused) {
                video.pause();
                return;
            }

            if (!isLastInMonth) return;

            if (remaining < 3 && remaining > 0 && !crossMonthSwitching && !hasPreparedCrossMonthTarget && crossMonthFailedVideoId !== currentVideoId) {
                handleCrossMonthPlay(video, currentVideoId);
            }
        }, true);

        endedListenerAttached = true;
    }

    function isPositiveTabActive() {
        const focusTab = document.querySelector('.show-tabs .tab.focus a');
        return !!focusTab && focusTab.textContent.trim() === '往期正片';
    }

    function checkIfLastInMonth() {
        if (!isPositiveTabActive()) {
            isLastInMonth = false;
            return;
        }
        const videoList = document.querySelector('[node-type="positive-videolist"] .aside-videolist');
        if (!videoList) { isLastInMonth = false; return; }

        const items = Array.from(videoList.querySelectorAll('li[data-vid]'));
        const playingItem = videoList.querySelector('li.playing');
        if (!playingItem || !items.length) { isLastInMonth = false; return; }

        isLastInMonth = items.indexOf(playingItem) === items.length - 1;
    }

    let crossMonthSwitching = false; // 防止 timeupdate 高频触发导致重复切换
    let crossMonthPrepareRetryTimer = null;
    let crossMonthFailedVideoId = null;
    let crossMonthBlockAutoplayVideoId = null;
    let crossMonthReadyTargetVid = null;
    let crossMonthReadyVideoId = null;
    let crossMonthPauseRequestedVideoId = null;

    function clearCrossMonthPrepareRetry() {
        if (crossMonthPrepareRetryTimer) {
            clearTimeout(crossMonthPrepareRetryTimer);
            crossMonthPrepareRetryTimer = null;
        }
    }

    function finishCrossMonthSwitch() {
        crossMonthSwitching = false;
    }

    function resetCrossMonthReadyState() {
        crossMonthReadyTargetVid = null;
        crossMonthReadyVideoId = null;
        crossMonthPauseRequestedVideoId = null;
        clearCrossMonthPrepareRetry();
    }

    function getReadyTargetLink() {
        if (!crossMonthReadyTargetVid) return null;
        return document.querySelector(`[node-type="positive-videolist"] .aside-videolist li[data-vid="${crossMonthReadyTargetVid}"] a`);
    }

    function getMonthKey(month) {
        return month ? (month.getAttribute('m-id') || month.textContent.trim()) : null;
    }

    function notifyCrossMonthFailure() {
        if (blocklistManagerInstance) {
            blocklistManagerInstance.showToast('跨月连播失败，请手动切换');
        }
    }

    function getMonthTabs() {
        return Array.from(document.querySelectorAll('.time-select .month.scroll-item'));
    }

    function getFocusedMonth() {
        return document.querySelector('.time-select .month.scroll-item.month-focus');
    }

    function getPositiveVideoList() {
        return document.querySelector('[node-type="positive-videolist"] .aside-videolist');
    }

    function getVideoListFirstVid(videoList) {
        const firstItem = videoList ? videoList.querySelector('li[data-vid]') : null;
        return firstItem ? firstItem.getAttribute('data-vid') : null;
    }

    function handleCrossMonthPlay(video, currentVideoId) {
        if (crossMonthSwitching) return;
        crossMonthSwitching = true;
        clearCrossMonthPrepareRetry();

        let prepareRetries = 15;
        const prepareCrossMonthTarget = () => {
            const months = getMonthTabs();
            if (!months.length) {
                prepareRetries -= 1;
                if (prepareRetries > 0) {
                    crossMonthBlockAutoplayVideoId = currentVideoId;
                    crossMonthPrepareRetryTimer = setTimeout(prepareCrossMonthTarget, 200);
                    return;
                }
                crossMonthFailedVideoId = currentVideoId;
                notifyCrossMonthFailure();
                finishCrossMonthSwitch();
                return;
            }

            const currentMonth = getFocusedMonth();
            if (!currentMonth) {
                prepareRetries -= 1;
                if (prepareRetries > 0) {
                    crossMonthBlockAutoplayVideoId = currentVideoId;
                    crossMonthPrepareRetryTimer = setTimeout(prepareCrossMonthTarget, 200);
                    return;
                }
                crossMonthFailedVideoId = currentVideoId;
                notifyCrossMonthFailure();
                finishCrossMonthSwitch();
                return;
            }

            const currentMonthIndex = months.indexOf(currentMonth);
            if (currentMonthIndex < 0) {
                prepareRetries -= 1;
                if (prepareRetries > 0) {
                    crossMonthBlockAutoplayVideoId = currentVideoId;
                    crossMonthPrepareRetryTimer = setTimeout(prepareCrossMonthTarget, 200);
                    return;
                }
                crossMonthFailedVideoId = currentVideoId;
                notifyCrossMonthFailure();
                finishCrossMonthSwitch();
                return;
            }

            const nextMonthIndex = currentMonthIndex - 1;

            if (nextMonthIndex < 0) {
                crossMonthBlockAutoplayVideoId = currentVideoId;
                finishCrossMonthSwitch();
                return;
            }

            const previousListFirstVid = getVideoListFirstVid(getPositiveVideoList());
            const nextMonth = months[nextMonthIndex];
            const nextMonthKey = getMonthKey(nextMonth);
            crossMonthBlockAutoplayVideoId = currentVideoId;

            nextMonth.click();

            let listRetries = 15;
            const tryPlayNextMonth = () => {
                const refreshedFocusedMonth = getFocusedMonth();
                const refreshedMonthKey = getMonthKey(refreshedFocusedMonth);
                const newVideoList = getPositiveVideoList();
                const firstItem = newVideoList ? newVideoList.querySelector('li[data-vid] a') : null;
                const currentListFirstVid = getVideoListFirstVid(newVideoList);
                const isListUpdated = !!currentListFirstVid && currentListFirstVid !== previousListFirstVid;

                if (refreshedMonthKey === nextMonthKey && isListUpdated && firstItem) {
                    const remaining = video.duration && isFinite(video.duration)
                        ? video.duration - video.currentTime
                        : Infinity;

                    if ((crossMonthPauseRequestedVideoId === currentVideoId && video.paused) || (remaining < 1 && remaining > 0)) {
                        if (!video.paused) {
                            crossMonthPauseRequestedVideoId = currentVideoId;
                            video.pause();
                        }
                        firstItem.click();
                        crossMonthFailedVideoId = null;
                        crossMonthBlockAutoplayVideoId = null;
                        resetCrossMonthReadyState();
                        finishCrossMonthSwitch();
                        return;
                    }

                    crossMonthReadyTargetVid = firstItem.closest('li[data-vid]')?.getAttribute('data-vid') || null;
                    crossMonthReadyVideoId = currentVideoId;
                    finishCrossMonthSwitch();
                    return;
                }

                listRetries -= 1;
                if (listRetries > 0) {
                    crossMonthPrepareRetryTimer = setTimeout(tryPlayNextMonth, 200);
                    return;
                }

                crossMonthFailedVideoId = currentVideoId;
                notifyCrossMonthFailure();
                finishCrossMonthSwitch();
            };

            crossMonthPrepareRetryTimer = setTimeout(tryPlayNextMonth, 200);
        };

        prepareCrossMonthTarget();
    }

    function initPlaylistEnhance() {
        restoreTab();
        attachEndedListener();
    }

    function ensurePersistentTooltips() {
        const toggleButton = document.getElementById('autoDanmuToggleBtn');
        if (toggleButton) {
            addTooltip(toggleButton, '💡 是否自动关闭弹幕', 'left');
        }

        const settingsButton = document.getElementById('mgtv_blocklist_setting_btn');
        if (settingsButton) {
            addTooltip(settingsButton, '💡 屏蔽词设置', 'left');
        }

        const importButton = document.getElementById('mgtv_btn_import');
        if (importButton) {
            addTooltip(importButton, '💡 导入后新增合并当前已有的屏蔽词', 'top');
        }
    }

    function init() {
        clearOldTooltips();
        closeDanmu();
        addDanmuShortcutTooltip();
        ensurePersistentTooltips();
        injectEpisodeTitleWrapStyle(); // 注入视频列表名称自动换行样式
        initPlaylistEnhance(); // 播放列表 Tab 记忆 & 跨月连播
        // 初始化屏蔽词管理器
        if (!blocklistManagerInstance) {
            blocklistManagerInstance = new BlocklistManager();
        }
    }

    // --- 高级屏蔽词功能 ---
    class BlocklistManager {
        constructor() {
            this.storageKey = 'mgtv_custom_blocklist';
            this.blocklist = this.load();
            this.compiledPatterns = this.compile(this.blocklist); // 预编译正则表达式
            this.initUI();
            this.startFilter();
        }

        compile(list) {
            return list.map(pattern => {
                const regexMatch = pattern.match(/^\/(.*?)\/([gimuy]*)$/);
                if (regexMatch) {
                    try {
                        const flags = regexMatch[2].replace(/g/g, '');
                        return new RegExp(regexMatch[1], flags);
                    } catch (e) {
                        return pattern;
                    }
                }
                return pattern;
            });
        }

        load() {
            try {
                return JSON.parse(localStorage.getItem(this.storageKey)) || [];
            } catch (e) {
                return [];
            }
        }

        save(list) {
            this.blocklist = list;
            this.compiledPatterns = this.compile(list); // 保存时同步更新预编译列表
            localStorage.setItem(this.storageKey, JSON.stringify(list));
            // 立即刷新过滤（可选，这里暂不处理已存在的弹幕，仅对新弹幕生效）
        }

        initUI() {
            this.createSettingsBtn();
            this.createModal();
            this.createToast();
        }

        createToast() {
            if (document.getElementById('mgtv_custom_toast')) return;
            const toast = document.createElement('div');
            toast.id = 'mgtv_custom_toast';
            toast.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.7); color: #fff; padding: 10px 20px;
                border-radius: 4px; font-size: 14px; z-index: 2147483647;
                opacity: 0; pointer-events: none; transition: opacity 0.3s;
            `;
            document.body.appendChild(toast);
        }

        showToast(msg) {
            const toast = document.getElementById('mgtv_custom_toast');
            if (!toast) return;
            toast.innerText = msg;
            toast.style.opacity = '1';
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                toast.style.opacity = '0';
            }, 2000);
        }

        createSettingsBtn() {
            const btnId = 'mgtv_blocklist_setting_btn';
            if (document.getElementById(btnId)) return;

            const btn = document.createElement('div');
            btn.id = btnId;
            btn.style.position = 'fixed';
            btn.style.bottom = '9px';
            btn.style.right = '58px';
            btn.style.zIndex = '9999';
            btn.style.width = '32px';
            btn.style.height = '32px';
            btn.style.backgroundColor = '#fff';
            btn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
            btn.style.cursor = 'pointer';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.borderRadius = '50%';
            btn.style.transition = 'transform 0.2s';

            // Shield Icon SVG
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path d="M15.273 19.469c-.662-.662-1.582-1.002-2.514-.931-1.767.137-3.58-.47-4.931-1.821-1.223-1.224-1.83-2.824-1.83-4.426 0-.604.086-1.208.258-1.792l3.771 3.771c1.912.417 4.652-2.353 4.242-4.242l-3.769-3.771c.583-.171 1.187-.257 1.790-.257 1.603 0 3.202.606 4.428 1.83 1.35 1.351 1.957 3.164 1.82 4.93-.072.933.268 1.853.93 2.514l2.843 2.843c1.066-1.793 1.689-3.88 1.689-6.117 0-6.627-5.373-12-12-12s-12 5.373-12 12 5.373 12 12 12c2.236 0 4.323-.623 6.115-1.688l-2.842-2.843z"/></svg>`;

            btn.addEventListener('click', () => this.openModal());
            btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.1)');
            btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');

            document.body.appendChild(btn);

            // 使用与主按钮相同的 Tooltip 样式
            addTooltip(btn, '💡 屏蔽词设置', 'left');
        }

        createModal() {
            if (document.getElementById('mgtv_blocklist_modal')) return;

            const modal = document.createElement('div');
            modal.id = 'mgtv_blocklist_modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.6); z-index: 2147483647;
                display: none; align-items: center; justify-content: center;
                backdrop-filter: blur(2px);
            `;

            const content = document.createElement('div');
            // 样式参考：简洁，圆角，阴影
            content.style.cssText = `
                background: #fff; width: 480px; max-width: 90%; 
                border-radius: 12px; padding: 24px; 
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color: #333;
                position: relative;
            `;

            // 芒果TV风格按钮样式
            const btnStyle = `padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; border: none; outline: none; transition: all 0.2s;`;
            const primaryBtnStyle = `${btnStyle} background: #FF5F00; color: #fff;`;
            const secondaryBtnStyle = `${btnStyle} background: transparent; color: #666; margin-right: 8px;`;

            content.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:18px; font-weight:600;">屏蔽词设置</h3>
                    <div id="mgtv_modal_close" style="cursor:pointer; font-size:20px; color:#999;">×</div>
                </div>
                
                <p style="font-size:13px; color:#666; margin-bottom:12px; line-height:1.5;">
                    每行一个屏蔽词。支持文本及正则表达式（如 <code style="background:#f5f5f5;padding:2px 4px;border-radius:4px;">/^haha\\d+$/i</code>）。
                </p>
                
                <textarea id="mgtv_blocklist_input" style="width:100%; height:240px; margin-bottom:16px; padding:12px; border:1px solid #ddd; border-radius:8px; font-family:monospace; font-size:14px; resize:vertical; box-sizing:border-box; outline:none;"></textarea>
                
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center;">
                        <button id="mgtv_btn_import" style="${secondaryBtnStyle}">导入</button>
                        <button id="mgtv_btn_export" style="${secondaryBtnStyle}">导出</button>
                        <input type="file" id="mgtv_file_input" style="display:none" accept=".txt">
                    </div>
                    <div>
                        <button id="mgtv_btn_cancel" style="${secondaryBtnStyle}">取消</button>
                        <button id="mgtv_btn_save" style="${primaryBtnStyle}">保存</button>
                    </div>
                </div>
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // 绑定事件
            const close = () => modal.style.display = 'none';
            content.querySelector('#mgtv_modal_close').addEventListener('click', close);
            content.querySelector('#mgtv_btn_cancel').addEventListener('click', close);
            content.querySelector('#mgtv_btn_save').addEventListener('click', () => this.saveFromUI());
            content.querySelector('#mgtv_btn_export').addEventListener('click', () => this.exportToFile());

            const importBtn = content.querySelector('#mgtv_btn_import');
            importBtn.addEventListener('click', () => document.getElementById('mgtv_file_input').click());

            document.getElementById('mgtv_file_input').addEventListener('change', (e) => this.importFromFile(e));

            // 按钮 Hover 效果
            const addBtnHover = (btn, hoverBg, normalBg = 'transparent') => {
                btn.addEventListener('mouseenter', () => btn.style.backgroundColor = hoverBg);
                btn.addEventListener('mouseleave', () => btn.style.backgroundColor = normalBg);
            };

            addBtnHover(content.querySelector('#mgtv_btn_save'), '#E55500', '#FF5F00');
            addBtnHover(content.querySelector('#mgtv_btn_cancel'), '#f0f0f0');
            addBtnHover(importBtn, '#f0f0f0');
            addBtnHover(content.querySelector('#mgtv_btn_export'), '#f0f0f0');

            // 为导入按钮添加自定义 Tooltip
            addTooltip(importBtn, '💡 导入后新增合并当前已有的屏蔽词', 'top');

            // 简单的Textarea focus样式
            const ta = document.getElementById('mgtv_blocklist_input');
            ta.addEventListener('focus', () => ta.style.borderColor = '#FF5F00');
            ta.addEventListener('blur', () => ta.style.borderColor = '#ddd');
        }

        openModal() {
            const modal = document.getElementById('mgtv_blocklist_modal');
            const textarea = document.getElementById('mgtv_blocklist_input');
            textarea.value = this.blocklist.join('\n');
            modal.style.display = 'flex';
        }

        saveFromUI() {
            const textarea = document.getElementById('mgtv_blocklist_input');
            const raw = textarea.value.split('\n').map(s => s.trim()).filter(s => s);
            const unique = [...new Set(raw)];
            this.save(unique);
            document.getElementById('mgtv_blocklist_modal').style.display = 'none';
            this.showToast('保存成功');
        }

        exportToFile() {
            const blob = new Blob([this.blocklist.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mgtv_blocklist.txt';
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('导出成功');
        }

        importFromFile(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target.result;
                const newItems = text.split('\n').map(s => s.trim()).filter(s => s);
                const current = document.getElementById('mgtv_blocklist_input').value.split('\n').map(s => s.trim()).filter(s => s);
                // 合并去重
                const combined = [...new Set([...current, ...newItems])];

                document.getElementById('mgtv_blocklist_input').value = combined.join('\n');
                this.showToast('导入成功，请点击保存生效');
            };
            reader.readAsText(file);
            e.target.value = '';
        }

        // --- 过滤核心逻辑 ---
        startFilter() {
            this.container = null;
            this.observer = new MutationObserver((mutations) => {
                for (let i = 0; i < mutations.length; i++) {
                    const addedNodes = mutations[i].addedNodes;
                    for (let j = 0; j < addedNodes.length; j++) {
                        const node = addedNodes[j];
                        if (node.nodeType === 1) {
                            this.checkAndBlock(node);
                        }
                    }
                }
            });

            this.reAnchorObserver();
        }

        // 性能核心：尝试寻找精准的弹幕容器进行监听，若找不到则回退到 body
        reAnchorObserver() {
            // 芒果TV 弹幕通常渲染在特定的容器内，通过探测找到它
            // 常见的可能容器类名（基于历史观察）
            const target = document.querySelector(".m-danmu-container") ||
                document.querySelector(".danmu-container") ||
                document.body;

            if (this.container !== target) {
                if (this.observer) this.observer.disconnect();
                this.container = target;
                this.observer.observe(target, { childList: true, subtree: true });
                // console.log(`[Performance] 过滤引擎观测点已切换至: ${target === document.body ? 'body (兜底)' : target.className}`);
            }
        }

        checkAndBlock(node) {
            // 快速检查：如果节点本身是 span
            if (node.classList && node.classList.contains('_danmuText_1qow5_77')) {
                this.performBlock(node);
                return;
            }
            // 否则尝试在子节点中寻找一次（不进行深度递归，仅一级 querySelector）
            const textSpan = node.querySelector ? node.querySelector('._danmuText_1qow5_77') : null;
            if (textSpan) {
                this.performBlock(textSpan);
            }
        }

        performBlock(textSpan) {
            const text = textSpan.innerText.trim();
            if (this.shouldBlock(text)) {
                // 尝试隐藏最外层容器（通常是 ._danmuItem...），如果找不到就隐藏 span 本身
                // 使用 closest 可以更精准地找到弹幕条目
                const container = textSpan.closest('div') || textSpan;
                container.style.display = 'none';
            }
        }

        shouldBlock(text) {
            if (!this.compiledPatterns || this.compiledPatterns.length === 0) return false;
            // 限制字数以防止正则灾难性回溯 (ReDoS) 过度消耗性能
            if (text.length > 500) return false;

            for (const pattern of this.compiledPatterns) {
                if (pattern instanceof RegExp) {
                    pattern.lastIndex = 0;
                    if (pattern.test(text)) return true;
                } else {
                    // 普通文本匹配
                    if (text.includes(pattern)) return true;
                }
            }
            return false;
        }
    }

    window.addEventListener('load', init);

    // 提取芒果TV视频ID，用于精准判断切集
    function getMgtvVideoId(url) {
        const match = url.match(/\/b\/\d+\/(\d+)\.html/);
        return match ? match[1] : url;
    }

    // 优化：使用定时轮询代替点击事件监听，以更稳定地检测 URL 变化，避免频繁触发定时器
    setInterval(() => {
        const currentUrl = window.location.href;
        if (getMgtvVideoId(currentUrl) !== getMgtvVideoId(lastUrl)) {
            lastUrl = currentUrl;
            isManualIntervention = false;
            lastManualTime = 0; // 在切集时清除锁定
            tabRestored = false; // 切集后允许再次恢复 Tab
            crossMonthSwitching = false; // 重置跨月切换锁
            crossMonthFailedVideoId = null;
            crossMonthBlockAutoplayVideoId = null;
            resetCrossMonthReadyState();
            init();
        }
        // 持续尝试恢复 Tab（DOM 可能延迟加载）
        if (!tabRestored) restoreTab();
        // v2.0.8：只要没被手动干预过，就始终尝试关闭（处理异步反复开启的情况）
        if (autoCloseDanmu && !isManualIntervention) {
            closeDanmu();
        }
        // 持续尝试优化过滤引擎的观测点
        if (blocklistManagerInstance) {
            blocklistManagerInstance.reAnchorObserver();
        }
        // 尝试更新全屏 tooltip 并且添加弹幕快捷键提示
        modifyFullscreenTooltip();
        addDanmuShortcutTooltip();
        
        // 顺势检查需要重新监听的 video 元素
        startObserveVideo();
    }, 1000); // v2.1.3 调低至 1s 一次，极致省电

    // 防抖函数，避免频繁触发
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    const debouncedInit = debounce(init, 1000);

    const titleObserver = new MutationObserver(debouncedInit);

    const titleElement = document.querySelector('title');
    if (titleElement) {
        titleObserver.observe(titleElement, { childList: true });
    }

    createToggleIconButton();

    // 监听视频关键事件，处理同页面重载视频（URL 不变但视频重启）的情况
    const resetAutoClose = (e) => {
        // v2.1.2：如果在手动操作锁定期内，忽略事件触发的重置
        if (Date.now() - lastManualTime < 5000) return;

        if (e.target.tagName === 'VIDEO') {
            isManualIntervention = false;
            crossMonthSwitching = false;
            crossMonthFailedVideoId = null;
            crossMonthBlockAutoplayVideoId = null;
            resetCrossMonthReadyState();
            init();
        }
    };

    // document.addEventListener('play', resetAutoClose, true); // v2.1.1 移除 play 监听，避免暂停恢复导致手动覆盖失效
    document.addEventListener('loadstart', resetAutoClose, true);
    document.addEventListener('emptied', resetAutoClose, true);

    // 针对同页面切集产生的视频地址变化进行监听
    const videoSrcObserver = new MutationObserver((mutations) => {
        // v2.1.2：如果在手动操作锁定期内，忽略 SRC 变化的重置
        if (Date.now() - lastManualTime < 5000) return;

        mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                isManualIntervention = false;
                crossMonthSwitching = false;
                crossMonthFailedVideoId = null;
                crossMonthBlockAutoplayVideoId = null;
                resetCrossMonthReadyState();
                init();
            }
        });
    });

    let currentObservedVideo = null;
    function startObserveVideo() {
        const video = document.querySelector('video');
        if (video && video !== currentObservedVideo) {
            currentObservedVideo = video;
            videoSrcObserver.disconnect();
            videoSrcObserver.observe(video, { attributes: true, attributeFilter: ['src'] });
        }
    }
})();

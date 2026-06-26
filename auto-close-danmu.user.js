// ==UserScript==
// @name         芒果TV网页版弹幕增强
// @namespace    http://tampermonkey.net/
// @version      2.5.34
// @description  芒果TV弹幕增强脚本：自动关闭弹幕、快捷键操作（D键切换弹幕/F键全屏）、相似弹幕合并与数量标记、高级屏蔽词设置、视频列表名称自动换行、播放列表Tab记忆与跨月自动连播、全屏下输入弹幕时按 ESC 不退出全屏
// @author       mankaki
// @match        *://www.mgtv.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mgtv.com
// @grant        GM_getValue
// @grant        GM_setValue
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

    // 统一的弹幕开关按钮选择器，兼容 CSS Modules 生成的 hash class（如 _danmuSwitcher_xxx）
    const DANMU_SWITCHER_SELECTOR = '[class*="danmuSwitcher"], .danmu-switch';
    function isDanmuSwitcherOn(btn) {
        if (!btn) return false;
        for (const c of btn.classList) {
            if (/^_?on(_|$)/i.test(c)) return true;
        }
        if (btn.getAttribute('aria-checked') === 'true') return true;
        return false;
    }

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

        const danmuBtn = document.querySelector(DANMU_SWITCHER_SELECTOR);

        if (danmuBtn) {
            const isOn = isDanmuSwitcherOn(danmuBtn);

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
        const btn = document.querySelector(DANMU_SWITCHER_SELECTOR);
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

    // 全屏下锁定 ESC,避免输入弹幕时按 ESC 退出全屏
    // 关键: Keyboard Lock 必须在用户手势或 fullscreenchange 事件上下文中调用才会生效
    let escapeLocked = false;
    function lockEscapeKey() {
        if (escapeLocked) return;
        if (navigator.keyboard && typeof navigator.keyboard.lock === 'function') {
            navigator.keyboard.lock(['Escape']).then(() => {
                escapeLocked = true;
            }).catch(() => {});
        }
    }
    function unlockEscapeKey() {
        if (!escapeLocked) return;
        if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
            try { navigator.keyboard.unlock(); } catch (e) {}
        }
        escapeLocked = false;
    }

    function isEditableTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
        if (el.isContentEditable) return true;
        if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
        return false;
    }

    // 浏览器原生全屏 或 芒果TV网页全屏(播放器带 fullscreen 类)
    function isAnyFullscreen() {
        if (document.fullscreenElement || document.webkitFullscreenElement) return true;
        const player = document.querySelector('.mango-player, .mgtv-player, #mgtv-player-wrap, .m-player-h5-new');
        const fullscreenNodes = [
            player,
            document.documentElement,
            document.body
        ];
        if (fullscreenNodes.some(node => node && /\b(fullscreen|web-fullscreen|is-fullscreen|pip-web-fs-active|web-fs-active)\b/.test(node.className))) return true;
        if (player) {
            const rect = player.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            if (
                Math.abs(rect.x) < 4 &&
                Math.abs(rect.y) < 4 &&
                rect.width >= viewportWidth * 0.82 &&
                rect.height >= viewportHeight * 0.72
            ) return true;
        }
        return false;
    }

    // 进入原生全屏时立刻锁 ESC (此刻仍在用户手势链中),退出时释放
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            lockEscapeKey();
        } else {
            unlockEscapeKey();
        }
        // 全屏状态切换后再刷新一次全屏按钮 tooltip（替代每秒轮询）
        try { modifyFullscreenTooltip(); } catch (e) {}
        try {
            removeFullscreenEpisodePanel();
            ensureFullscreenEpisodeButton();
        } catch (e) {}
    });
    document.addEventListener('webkitfullscreenchange', () => {
        if (document.webkitFullscreenElement) {
            lockEscapeKey();
        } else {
            unlockEscapeKey();
        }
        try { modifyFullscreenTooltip(); } catch (e) {}
        try {
            removeFullscreenEpisodePanel();
            ensureFullscreenEpisodeButton();
        } catch (e) {}
    });

    // ESC 被锁定后会以普通键事件送达: 输入框里按只失焦, 其他地方按则手动退出全屏
    const escInterceptor = (e) => {
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        if (!isAnyFullscreen()) return;
        const target = e.target || document.activeElement;
        if (isEditableTarget(target)) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            if (e.type === 'keydown' && typeof target.blur === 'function') target.blur();
            return;
        }
        // 非输入框场景下,保持"ESC = 退出全屏"的原有行为
        if (e.type === 'keydown') {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    };
    window.addEventListener('keydown', escInterceptor, true);
    window.addEventListener('keyup', escInterceptor, true);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F' || e.key === 'Escape') {
            cancelFullscreenEpisodeRefocus();
            return;
        }
        if (e.key === 'q' || e.key === 'Q') {
            if (e.isComposing || e.keyCode === 229 || isTyping()) return;
            const scriptWebFullscreenContainer = getScriptWebFullscreenContainer();
            if (scriptWebFullscreenContainer) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                suppressNextQKeyup = true;
                mgtvQKeyStartedInWebFullscreen = false;
                restoreScriptWebFullscreenContainer(scriptWebFullscreenContainer);
                return;
            }
            mgtvQKeyStartedInWebFullscreen = document.body.classList.contains('pip-web-fs-active') ||
                document.body.classList.contains('web-fs-active');
            if (mgtvQKeyStartedInWebFullscreen) {
                toggleFullscreenEpisodePanel(false);
                releaseFullscreenEpisodeFocus();
                scheduleMgtvWebFullscreenExitRepair();
            } else {
                scheduleMgtvWebFullscreenEnterFallback();
            }
        }
    }, true);

    window.addEventListener('keyup', (e) => {
        if (e.key !== 'q' && e.key !== 'Q') return;
        if (e.isComposing || e.keyCode === 229 || isTyping()) return;
        if (suppressNextQKeyup) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            suppressNextQKeyup = false;
            return;
        }
        if (getScriptWebFullscreenContainer()) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            suppressNextQKeyup = false;
            mgtvQKeyStartedInWebFullscreen = false;
            return;
        }
        if (mgtvQKeyStartedInWebFullscreen) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            mgtvQKeyStartedInWebFullscreen = false;
            return;
        }
        if (document.body.classList.contains('pip-web-fs-active') ||
            document.body.classList.contains('web-fs-active')) return;
        scheduleMgtvWebFullscreenEnterFallback();
    }, true);

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
        const isDanmuBtn = e.target.closest(DANMU_SWITCHER_SELECTOR);

        if (isDanmuBtn) {
            // 用户手动点击了开关，记录为手动干预及时间戳
            isManualIntervention = true;
            lastManualTime = Date.now();
            // console.log("检测到用户手动操作，触发 5s 强制停火锁定");
        }
    }, true);

    function addDanmuShortcutTooltip() {
        const danmuButtons = document.querySelectorAll(DANMU_SWITCHER_SELECTOR);
        danmuButtons.forEach(btn => {
            if (!btn || btn.dataset.mgtvTooltipAttached) return;
            // 使用默认上方 tooltip
            addTooltip(btn, "💡 按 D 键可开关弹幕", 'top');
        });
    }

    // 尝试修改全屏按钮 tooltip。芒果TV 将"全屏"文案渲染在 hover 出现的 popover 中（class 含 popoverTips），
    // 因此必须持续尝试匹配；限定扫描范围到播放器内的 popover 容器，避免全文档遍历
    function modifyFullscreenTooltip() {
        const contextNode = document.fullscreenElement ||
            document.querySelector('.mango-player, .mgtv-player, #mgtv-player-wrap') ||
            document.body;

        // 1. 旧版 title 属性路径（保留兼容）
        const fsBtns = contextNode.querySelectorAll('[title="全屏"]');
        fsBtns.forEach(btn => {
            btn.title = '全屏 (F)';
        });

        // 2. 新版 popover 文案：匹配 _popoverTips_xxx / _PopoverContent_xxx 等容器的叶子节点
        const popovers = contextNode.querySelectorAll('[class*="popoverTips"], [class*="PopoverContent"]');
        for (const node of popovers) {
            if (node.childElementCount !== 0) continue;
            if (node.textContent.trim() === '全屏') {
                node.textContent = '全屏 (F)';
            }
        }
    }

    // --- 视频列表名称自动换行 ---
    function injectEpisodeTitleWrapStyle() {
        let style = document.getElementById('mgtv_episode_wrap_style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'mgtv_episode_wrap_style';
            document.head.appendChild(style);
        }

        if (!style.textContent.includes('span.name')) {
            style.textContent += `
            span.name {
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: unset !important;
                word-break: break-word !important;
            }
            `;
        }

        let fullscreenEpisodeStyle = document.getElementById('mgtv_fullscreen_episode_style');
        if (!fullscreenEpisodeStyle) {
            fullscreenEpisodeStyle = document.createElement('style');
            fullscreenEpisodeStyle.id = 'mgtv_fullscreen_episode_style';
            document.head.appendChild(fullscreenEpisodeStyle);
        }
        fullscreenEpisodeStyle.textContent = `
            #mgtv_fullscreen_episode_btn {
                display: none;
                align-items: center;
                justify-content: center;
                height: 21px;
                padding: 0;
                margin: 0 0 0 16px;
                color: #fff;
                font-size: 14px;
                line-height: 21px;
                cursor: pointer;
                user-select: none;
                background: transparent;
                transition: color 0.2s ease;
            }

            #mgtv_fullscreen_episode_btn:hover,
            #mgtv_fullscreen_episode_btn.mgtv-fullscreen-episode-active {
                color: #ff5f00;
                background: transparent;
            }

            #mgtv_fullscreen_episode_panel {
                position: fixed !important;
                right: 92px !important;
                bottom: 72px !important;
                width: min(380px, calc(100vw - 48px));
                max-height: min(58vh, 560px);
                z-index: 2147483647;
                display: none;
                overflow: hidden;
                box-sizing: border-box;
                color: #fff;
                background: rgba(6, 8, 18, 0.94);
                border: 0;
                border-radius: 8px;
                box-shadow: 0 14px 38px rgba(0, 0, 0, 0.42);
                backdrop-filter: blur(8px);
            }

            #mgtv_fullscreen_episode_panel.mgtv-fullscreen-episode-open {
                display: flex;
                flex-direction: column;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-head {
                display: none;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-height: 44px;
                padding: 0 14px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 15px;
                font-weight: 600;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-close {
                width: 28px;
                height: 28px;
                border: 0;
                padding: 0;
                color: #fff;
                background: transparent;
                font-size: 24px;
                line-height: 26px;
                cursor: pointer;
                opacity: 0.78;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-close:hover {
                opacity: 1;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-body {
                overflow: auto;
                padding: 8px;
                scrollbar-width: thin;
                scrollbar-color: rgba(255, 255, 255, 0.36) transparent;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-body::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-body::-webkit-scrollbar-track {
                background: transparent;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-body::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.34);
                border-radius: 999px;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-months {
                display: flex;
                gap: 8px;
                padding: 8px 8px 2px;
                overflow-x: auto;
                scrollbar-width: none;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-months::-webkit-scrollbar {
                width: 0;
                height: 0;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-month {
                flex: 0 0 auto;
                border: 0;
                padding: 5px 10px;
                color: rgba(255, 255, 255, 0.62);
                background: transparent;
                border-radius: 6px;
                font-size: 14px;
                line-height: 18px;
                cursor: pointer;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-month:hover,
            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-month.mgtv-fullscreen-episode-month-active {
                color: #ff5f00;
                background: rgba(255, 95, 0, 0.12);
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-list {
                display: grid !important;
                grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
                gap: 10px;
                margin: 0 !important;
                padding: 0 !important;
                list-style: none !important;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-list-long {
                grid-template-columns: 1fr;
                gap: 2px;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-group {
                display: contents;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-item {
                list-style: none !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-link {
                display: flex !important;
                align-items: center;
                justify-content: center;
                min-height: 36px;
                padding: 0 8px;
                box-sizing: border-box;
                color: rgba(255, 255, 255, 0.9) !important;
                background: transparent;
                border: 0;
                border-radius: 6px;
                font-size: 14px;
                line-height: 18px;
                text-align: center;
                text-decoration: none !important;
                white-space: normal;
                word-break: break-word;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-list-long .mgtv-fullscreen-episode-link {
                justify-content: flex-start;
                min-height: 34px;
                padding: 7px 10px;
                line-height: 20px;
                text-align: left;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-item.mgtv-fullscreen-episode-current .mgtv-fullscreen-episode-link,
            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-link:hover {
                color: #ff5f00 !important;
                background: transparent;
            }

            #mgtv_fullscreen_episode_panel .mgtv-fullscreen-episode-empty {
                padding: 20px;
                color: rgba(255, 255, 255, 0.72);
                text-align: center;
            }
        `;
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
        return document.querySelector('[node-type="positive-videolist"] .aside-videolist') ||
            document.querySelector('[node-type="episode-aside-videolist"] .episode-items') ||
            document.querySelector('.m-tv-aside-list [node-type="episode-aside-videolist"] .episode-items');
    }

    let playlistLocateTimer = null;
    let playlistLocateTargetVideoId = null;
    let playlistLocateDoneVideoId = null;
    const FULLSCREEN_EPISODE_UI_VERSION = '2.5.34';
    let fullscreenEpisodeCloseTimer = null;
    let fullscreenEpisodeStateSignature = '';
    let fullscreenEpisodeKeepOpenUntil = 0;
    let fullscreenEpisodeMonthSwitching = false;
    let fullscreenEpisodeRefocusToken = 0;
    let fullscreenEpisodeMonthSwitchToken = 0;
    let mgtvWebFullscreenExitRepairToken = 0;
    let mgtvQKeyStartedInWebFullscreen = false;
    let suppressNextQKeyup = false;
    const scriptWebFullscreenRestoreMap = new WeakMap();

    function findCurrentPlaylistItem(videoId, allowPlayingFallback = false) {
        const videoList = getPositiveVideoList();
        if (!videoList || !videoId) return null;

        const currentItem = Array.from(videoList.querySelectorAll('li[data-vid]'))
            .find(item => item.getAttribute('data-vid') === videoId);
        if (currentItem) return currentItem;

        return allowPlayingFallback ? videoList.querySelector('li.playing[data-vid]') : null;
    }

    function getScrollableAncestor(element) {
        let node = element ? element.parentElement : null;
        while (node && node !== document.body) {
            if (node.scrollHeight > node.clientHeight + 1) return node;
            node = node.parentElement;
        }
        return null;
    }

    function scrollPlaylistItemIntoView(item) {
        const scrollContainer = getScrollableAncestor(item);
        if (!scrollContainer) {
            item.scrollIntoView({ block: 'center', inline: 'nearest' });
            return;
        }

        const itemRect = item.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const centeredOffset = (itemRect.top - containerRect.top) - ((containerRect.height - itemRect.height) / 2);
        scrollContainer.scrollTop += centeredOffset;
    }

    function scheduleLocateCurrentVideoInPlaylist() {
        const videoId = getMgtvVideoId(window.location.href);
        if (!videoId || playlistLocateDoneVideoId === videoId) return;
        if (playlistLocateTimer && playlistLocateTargetVideoId === videoId) return;

        if (playlistLocateTimer) {
            clearTimeout(playlistLocateTimer);
            playlistLocateTimer = null;
        }

        playlistLocateTargetVideoId = videoId;
        let retries = 24;

        const tryLocate = () => {
            playlistLocateTimer = null;

            const currentVideoId = getMgtvVideoId(window.location.href);
            if (currentVideoId !== videoId) {
                playlistLocateTargetVideoId = null;
                scheduleLocateCurrentVideoInPlaylist();
                return;
            }

            const item = findCurrentPlaylistItem(videoId);
            if (item) {
                scrollPlaylistItemIntoView(item);
                playlistLocateDoneVideoId = videoId;
                playlistLocateTargetVideoId = null;
                return;
            }

            retries -= 1;
            if (retries > 0) {
                playlistLocateTimer = setTimeout(tryLocate, 250);
                return;
            }

            const fallbackItem = findCurrentPlaylistItem(videoId, true);
            if (fallbackItem) {
                scrollPlaylistItemIntoView(fallbackItem);
                playlistLocateDoneVideoId = videoId;
            }
            playlistLocateTargetVideoId = null;
        };

        playlistLocateTimer = setTimeout(tryLocate, 100);
    }

    function getPlayerRoot() {
        const candidates = Array.from(document.querySelectorAll('.mango-player, .mgtv-player, #mgtv-player-wrap, .m-player-h5-new, .m-player'));
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        return candidates.find(node => {
            const rect = node.getBoundingClientRect();
            return Math.abs(rect.x) < 4 &&
                Math.abs(rect.y) < 4 &&
                rect.width >= viewportWidth * 0.82 &&
                rect.height >= viewportHeight * 0.72;
        }) ||
            candidates.find(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 300 &&
                    rect.height > 180 &&
                    rect.bottom > 0 &&
                    rect.right > 0 &&
                    rect.top < viewportHeight &&
                    rect.left < viewportWidth;
            }) ||
            candidates[0] ||
            document.fullscreenElement ||
            document.body;
    }

    function findFullscreenSpeedControl() {
        const player = getPlayerRoot();
        const visibleParent = (node) => {
            let current = node;
            while (current && current !== player && current !== document.body) {
                const rect = current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return true;
                current = current.parentElement;
            }
            return false;
        };

        const rateButton = Array.from(player.querySelectorAll('.playRateBtn, [class*="playRate"], [class*="PlayRate"], [class*="rateBtn"], [class*="RateBtn"]'))
            .find(node => node.parentElement && visibleParent(node));
        if (rateButton) return rateButton;

        const candidates = Array.from(player.querySelectorAll('div, button, span, p'))
            .filter(node => {
                const text = node.textContent ? node.textContent.trim() : '';
                return text === '倍速' || (text.includes('倍速') && text.length <= 40);
            });

        if (candidates.length) {
            const buttonLike = candidates
                .map(node => node.closest('.playRateBtn, [class*="playRate"], [class*="PlayRate"], [class*="rateBtn"], [class*="RateBtn"], button, [role="button"], [class*="button"], [class*="Button"], [class*="speed"], [class*="Speed"]') || node)
                .find(node => node && node.parentElement && visibleParent(node));

            if (buttonLike) return buttonLike;
        }

        const classFallback = Array.from(player.querySelectorAll('[class*="speed"], [class*="Speed"]'))
            .find(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && node.parentElement;
            });

        return classFallback || candidates[0] || null;
    }

    function findFullscreenControlRightList() {
        const player = getPlayerRoot();
        return Array.from(player.querySelectorAll('.controlBarRight, [class*="RightList"], [class*="rightList"]'))
            .find(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }) || null;
    }

    function getFullscreenEpisodeMount() {
        const speedControl = findFullscreenSpeedControl();
        if (speedControl && speedControl.parentElement) {
            return { speedControl, parent: speedControl.parentElement };
        }
        const rightList = findFullscreenControlRightList();
        if (rightList) {
            const beforeNode = rightList.querySelector('.clarityBtn, [class*="clarity"], [class*="Clarity"], .fullscreenBtn, [class*="fullscreen"], [class*="Fullscreen"]');
            return { speedControl: null, parent: rightList, beforeNode };
        }
        return { speedControl: null, parent: getPlayerRoot() };
    }

    function stripDuplicateIds(root) {
        if (!root) return;
        if (root.removeAttribute) root.removeAttribute('id');
        root.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    }

    function getFullscreenContainer() {
        return document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;
    }

    function getFullscreenEpisodeStateSignature() {
        const player = document.querySelector('.mango-player, .mgtv-player, #mgtv-player-wrap, .m-player-h5-new');
        return [
            isAnyFullscreen() ? '1' : '0',
            document.fullscreenElement ? 'native' : 'web',
            player ? player.className : ''
        ].join('|');
    }

    function removeFullscreenEpisodePanel() {
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        if (panel) panel.remove();
    }

    function normalizeEpisodeTitleText(text) {
        return (text || '')
            .replace(/\s+/g, ' ')
            .replace(/^(VIP|SVIP)+\s*/i, '')
            .replace(/(^|[：:\s])(VIP|SVIP)+(?=[\u4e00-\u9fa5A-Za-z])/ig, '$1')
            .replace(/(\d{4}-\d{2}-\d{2})\s*(VIP|SVIP)+/ig, '$1 ')
            .replace(/([^\s])第(\d+)(集|期)/g, '$1 第$2$3')
            .replace(/(第\d+(?:集|期)[上下中]?)([^\s：:·，,.、])/g, '$1 $2')
            .replace(/\s+([：:·，,.、])/g, '$1')
            .replace(/([：:])\s+/g, '$1')
            .trim();
    }

    function getCleanEpisodeText(sourceItem, link) {
        const titleNodes = Array.from(sourceItem.querySelectorAll('.title, .name, [class*="title"], [class*="Title"], [class*="name"], [class*="Name"]'))
            .filter(node => {
                const text = (node.textContent || '').trim();
                return text && text !== 'VIP';
            });
        const titleNode = titleNodes[titleNodes.length - 1] || null;
        const rawText = (
            (link && (link.getAttribute('title') || link.getAttribute('aria-label'))) ||
            (titleNode && titleNode.textContent) ||
            (link && link.textContent) ||
            sourceItem.textContent ||
            ''
        ).trim();

        return normalizeEpisodeTitleText(rawText);
    }

    function getFullscreenEpisodeMonths() {
        return getMonthTabs().map(month => ({
            key: getMonthKey(month),
            text: month.textContent.trim(),
            active: month.classList.contains('month-focus'),
            node: month
        })).filter(month => month.text);
    }

    function ensureFullscreenEpisodePanel() {
        let panel = document.getElementById('mgtv_fullscreen_episode_panel');
        if (panel && panel.dataset.mgtvEpisodeVersion !== FULLSCREEN_EPISODE_UI_VERSION) {
            panel.remove();
            panel = null;
        }
        const container = getFullscreenContainer();

        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'mgtv_fullscreen_episode_panel';
            panel.dataset.mgtvEpisodeVersion = FULLSCREEN_EPISODE_UI_VERSION;

            const head = document.createElement('div');
            head.className = 'mgtv-fullscreen-episode-head';

            const title = document.createElement('span');
            title.textContent = '选集';

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'mgtv-fullscreen-episode-close';
            closeButton.textContent = '×';
            closeButton.addEventListener('click', () => toggleFullscreenEpisodePanel(false));

            const body = document.createElement('div');
            body.className = 'mgtv-fullscreen-episode-body';

            head.appendChild(title);
            head.appendChild(closeButton);
            panel.appendChild(head);
            panel.appendChild(body);

            panel.addEventListener('mouseenter', clearFullscreenEpisodeCloseTimer);
            panel.addEventListener('mouseleave', () => scheduleFullscreenEpisodeClose());
        }

        if (panel.parentNode !== container) {
            container.appendChild(panel);
        }

        return panel;
    }

    function syncFullscreenEpisodePanel() {
        const panel = ensureFullscreenEpisodePanel();
        const body = panel.querySelector('.mgtv-fullscreen-episode-body');
        const sourceList = getPositiveVideoList();

        if (!body) return panel;
        body.textContent = '';

        const months = getFullscreenEpisodeMonths();
        if (months.length > 1) {
            const monthList = document.createElement('div');
            monthList.className = 'mgtv-fullscreen-episode-months';
            months.forEach(month => {
                const monthButton = document.createElement('button');
                monthButton.type = 'button';
                monthButton.className = 'mgtv-fullscreen-episode-month';
                if (month.active) monthButton.classList.add('mgtv-fullscreen-episode-month-active');
                monthButton.textContent = month.text;
                monthButton.dataset.monthKey = month.key || month.text;
                monthButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                    clearFullscreenEpisodeCloseTimer();
                    fullscreenEpisodeMonthSwitching = true;
                    fullscreenEpisodeKeepOpenUntil = Date.now() + 1200;
                    const monthSwitchToken = ++fullscreenEpisodeMonthSwitchToken;
                    monthList.querySelectorAll('.mgtv-fullscreen-episode-month-active')
                        .forEach(node => node.classList.remove('mgtv-fullscreen-episode-month-active'));
                    monthButton.classList.add('mgtv-fullscreen-episode-month-active');
                    month.node.click();
                    const refreshMonthList = (finalRefresh = false) => {
                        if (monthSwitchToken !== fullscreenEpisodeMonthSwitchToken) return;
                        if (document.getElementById('mgtv_fullscreen_episode_panel')?.classList.contains('mgtv-fullscreen-episode-open')) {
                            syncFullscreenEpisodePanel();
                        }
                        if (finalRefresh && monthSwitchToken === fullscreenEpisodeMonthSwitchToken) {
                            fullscreenEpisodeMonthSwitching = false;
                        }
                    };
                    setTimeout(() => refreshMonthList(false), 160);
                    setTimeout(() => refreshMonthList(true), 560);
                });
                monthList.appendChild(monthButton);
            });
            body.appendChild(monthList);
        }

        if (!sourceList) {
            const empty = document.createElement('div');
            empty.className = 'mgtv-fullscreen-episode-empty';
            empty.textContent = '播放列表还没加载出来';
            body.appendChild(empty);
            return panel;
        }

        const currentId = getMgtvVideoId(window.location.href);
        const list = document.createElement('ul');
        list.className = 'mgtv-fullscreen-episode-list';
        const episodeEntries = [];

        Array.from(sourceList.querySelectorAll('li[data-vid]')).forEach(sourceItem => {
            const link = sourceItem.querySelector('a');
            const vid = sourceItem.getAttribute('data-vid');
            const text = getCleanEpisodeText(sourceItem, link);
            if (!vid || !link || !text) return;
            const fullText = (sourceItem.textContent || '').trim();
            const dateMatch = (fullText.match(/(\d{4})-(\d{2})-(\d{2})/) || text.match(/(\d{4})-(\d{2})-(\d{2})/));
            const group = dateMatch ? `${dateMatch[2]}月` : '';
            const displayText = dateMatch && !text.includes(dateMatch[0])
                ? `${dateMatch[0]} ${text}`
                : text;
            episodeEntries.push({ sourceItem, link, vid, text: displayText, group });
        });

        const maxTitleLength = episodeEntries.reduce((max, entry) => Math.max(max, entry.text.length), 0);
        const averageTitleLength = episodeEntries.length
            ? episodeEntries.reduce((sum, entry) => sum + entry.text.length, 0) / episodeEntries.length
            : 0;
        const hasDateGroups = episodeEntries.some(entry => entry.group);
        if (hasDateGroups || maxTitleLength > 8 || averageTitleLength > 5) {
            list.classList.add('mgtv-fullscreen-episode-list-long');
        }

        episodeEntries.forEach(({ sourceItem, link, vid, text }) => {
            const item = document.createElement('li');
            item.className = 'mgtv-fullscreen-episode-item';
            item.setAttribute('data-vid', vid);
            if (vid === currentId || sourceItem.classList.contains('playing') || sourceItem.classList.contains('focus')) {
                item.classList.add('mgtv-fullscreen-episode-current');
            }

            const itemLink = document.createElement('a');
            itemLink.className = 'mgtv-fullscreen-episode-link';
            itemLink.href = link.href;
            itemLink.textContent = text;
            itemLink.title = text;

            item.appendChild(itemLink);
            list.appendChild(item);
        });

        if (!list.children.length) {
            const empty = document.createElement('div');
            empty.className = 'mgtv-fullscreen-episode-empty';
            empty.textContent = '播放列表还没加载出来';
            body.appendChild(empty);
            return panel;
        }

        body.appendChild(list);

        panel._mgtvCurrentEpisodeItem = currentId ? list.querySelector(`li[data-vid="${currentId}"]`) : list.querySelector('.mgtv-fullscreen-episode-current');

        return panel;
    }

    function clearFullscreenEpisodeCloseTimer() {
        if (fullscreenEpisodeCloseTimer) {
            clearTimeout(fullscreenEpisodeCloseTimer);
            fullscreenEpisodeCloseTimer = null;
        }
    }

    function scheduleFullscreenEpisodeClose(delay = 360) {
        clearFullscreenEpisodeCloseTimer();
        fullscreenEpisodeCloseTimer = setTimeout(() => {
            if (fullscreenEpisodeMonthSwitching) return;
            if (Date.now() < fullscreenEpisodeKeepOpenUntil) {
                scheduleFullscreenEpisodeClose(fullscreenEpisodeKeepOpenUntil - Date.now() + 120);
                return;
            }
            const panel = document.getElementById('mgtv_fullscreen_episode_panel');
            if (panel && panel.matches(':hover')) return;
            const button = document.getElementById('mgtv_fullscreen_episode_btn');
            if (button && button.matches(':hover')) return;
            toggleFullscreenEpisodePanel(false);
        }, delay);
    }

    function refocusFullscreenAfterEpisodeSwitch(wasFullscreen, wasNativeFullscreen) {
        if (!wasFullscreen || !wasNativeFullscreen) return;

        let retries = 12;
        const refocusToken = ++fullscreenEpisodeRefocusToken;
        const keepFullscreen = () => {
            if (refocusToken !== fullscreenEpisodeRefocusToken) return;
            if (isAnyFullscreen()) return;
            const player = getPlayerRoot();
            if (wasNativeFullscreen && player && player.requestFullscreen) {
                player.requestFullscreen().catch(() => {});
            } else if (wasNativeFullscreen && player && player.webkitRequestFullscreen) {
                try { player.webkitRequestFullscreen(); } catch (e) {}
            }

            retries -= 1;
            if (retries > 0 && !isAnyFullscreen()) {
                setTimeout(keepFullscreen, 500);
            }
        };

        keepFullscreen();
        setTimeout(keepFullscreen, 250);
    }

    function cancelFullscreenEpisodeRefocus() {
        fullscreenEpisodeRefocusToken += 1;
    }

    function releaseFullscreenEpisodeFocus() {
        const active = document.activeElement;
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        const button = document.getElementById('mgtv_fullscreen_episode_btn');
        if (active && (
            active === button ||
            (button && button.contains(active)) ||
            (panel && panel.contains(active))
        ) && typeof active.blur === 'function') {
            active.blur();
        }

        const focusTarget = document.querySelector('video') || getPlayerRoot() || document.body;
        if (focusTarget && typeof focusTarget.focus === 'function') {
            const hadTabIndex = focusTarget.hasAttribute('tabindex');
            const oldTabIndex = focusTarget.getAttribute('tabindex');
            if (!hadTabIndex) focusTarget.setAttribute('tabindex', '-1');
            try { focusTarget.focus({ preventScroll: true }); } catch (e) {}
            if (!hadTabIndex) {
                setTimeout(() => focusTarget.removeAttribute('tabindex'), 0);
            } else if (oldTabIndex !== null) {
                focusTarget.setAttribute('tabindex', oldTabIndex);
            }
        }
    }

    function finishWebFullscreenExitCleanup() {
        restoreScriptWebFullscreenPageStyle();
        document.body.classList.remove('pip-web-fs-active', 'web-fs-active');
        document.documentElement.classList.remove('pip-web-fs-active', 'web-fs-active');
        removeFullscreenEpisodePanel();
        const button = document.getElementById('mgtv_fullscreen_episode_btn');
        if (button) {
            button.classList.remove('mgtv-fullscreen-episode-active');
            button.style.display = 'none';
        }
        fullscreenEpisodeStateSignature = '';
    }

    function rememberElementStyle(element, datasetKey) {
        if (!element || element.dataset[datasetKey] !== undefined) return;
        element.dataset[datasetKey] = element.getAttribute('style') || '__empty__';
    }

    function restoreElementStyle(element, datasetKey) {
        if (!element || element.dataset[datasetKey] === undefined) return;
        const oldStyle = element.dataset[datasetKey];
        if (oldStyle === '__empty__') {
            element.removeAttribute('style');
        } else {
            element.setAttribute('style', oldStyle);
        }
        delete element.dataset[datasetKey];
    }

    function lockScriptWebFullscreenPageStyle() {
        rememberElementStyle(document.documentElement, 'mgtvScriptOldStyle');
        rememberElementStyle(document.body, 'mgtvScriptOldStyle');

        document.documentElement.style.overflow = 'hidden';
        document.documentElement.style.height = '100%';
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
    }

    function restoreScriptWebFullscreenPageStyle() {
        restoreElementStyle(document.documentElement, 'mgtvScriptOldStyle');
        restoreElementStyle(document.body, 'mgtvScriptOldStyle');
    }

    function getScriptWebFullscreenContainer() {
        return Array.from(document.querySelectorAll('.mgtv-script-web-fullscreen-container, .pip-web-fullscreen-container'))
            .find(node => node.dataset.mgtvScriptWebFullscreen === 'true') || null;
    }

    function findScriptWebFullscreenRestoreHost(container) {
        const anchor = document.querySelector('.mgtv-script-web-fullscreen-anchor[data-mgtv-script-web-fullscreen="true"], .pip-web-fullscreen-anchor[data-mgtv-script-web-fullscreen="true"]');
        if (anchor && anchor.parentNode) return { anchor, parent: anchor.parentNode };

        const savedTarget = scriptWebFullscreenRestoreMap.get(container);
        if (savedTarget && savedTarget.parent && savedTarget.parent.isConnected) {
            return savedTarget;
        }

        return null;
    }

    function restoreScriptWebFullscreenContainer(container) {
        if (!container || container.dataset.mgtvScriptWebFullscreen !== 'true') return false;

        const player = container.querySelector('#mgtv-player-wrap, .m-player-h5-new, .mango-player, .mgtv-player');
        const restoreTarget = findScriptWebFullscreenRestoreHost(container);
        if (player && restoreTarget && restoreTarget.parent) {
            const beforeNode = restoreTarget.anchor ||
                (restoreTarget.nextSibling && restoreTarget.nextSibling.parentNode === restoreTarget.parent
                    ? restoreTarget.nextSibling
                    : null);
            restoreTarget.parent.insertBefore(player, beforeNode);
        } else if (player) {
            return false;
        }
        if (player) {
            const oldStyle = player.dataset.mgtvScriptOldStyle;
            if (oldStyle === undefined || oldStyle === '__empty__') {
                player.removeAttribute('style');
            } else {
                player.setAttribute('style', oldStyle);
            }
            delete player.dataset.mgtvScriptOldStyle;
            player.classList.remove('pip-web-fs-player', 'player-l');
            player.classList.add('player-m');
        }
        if (restoreTarget && restoreTarget.anchor) restoreTarget.anchor.remove();
        scriptWebFullscreenRestoreMap.delete(container);
        container.remove();
        finishWebFullscreenExitCleanup();
        return true;
    }

    function forceScriptWebFullscreenEnter() {
        const staleScriptContainer = getScriptWebFullscreenContainer();
        if (staleScriptContainer) restoreScriptWebFullscreenContainer(staleScriptContainer);

        if (isAnyFullscreen()) return false;
        if (document.body.classList.contains('pip-web-fs-active') ||
            document.body.classList.contains('web-fs-active')) return false;

        const player = document.querySelector('#mgtv-player-wrap') ||
            document.querySelector('.m-player-h5-new') ||
            getPlayerRoot();
        if (!player || player.closest('.mgtv-script-web-fullscreen-container, .pip-web-fullscreen-container')) return false;

        const anchor = document.createElement('div');
        anchor.className = 'mgtv-script-web-fullscreen-anchor';
        anchor.dataset.mgtvScriptWebFullscreen = 'true';
        const rect = player.getBoundingClientRect();
        anchor.style.width = `${Math.max(1, rect.width)}px`;
        anchor.style.height = `${Math.max(1, rect.height)}px`;
        anchor.style.display = 'block';

        const container = document.createElement('div');
        container.className = 'mgtv-script-web-fullscreen-container';
        container.dataset.mgtvScriptWebFullscreen = 'true';
        container.style.position = 'fixed';
        container.style.inset = '0';
        container.style.zIndex = '2147483000';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.background = '#000';
        container.style.overflow = 'hidden';

        lockScriptWebFullscreenPageStyle();
        rememberElementStyle(player, 'mgtvScriptOldStyle');
        scriptWebFullscreenRestoreMap.set(container, {
            parent: player.parentNode,
            nextSibling: player.nextSibling
        });
        player.parentNode.insertBefore(anchor, player);
        document.body.appendChild(container);
        container.appendChild(player);

        player.style.position = 'absolute';
        player.style.inset = '0';
        player.style.width = '100vw';
        player.style.height = '100vh';
        player.style.maxWidth = '100vw';
        player.style.maxHeight = '100vh';
        player.style.margin = '0';
        player.style.overflow = 'hidden';
        player.classList.add('pip-web-fs-player');

        document.body.classList.add('pip-web-fs-active');
        ensureFullscreenEpisodeButton();
        setTimeout(ensureFullscreenEpisodeButton, 260);
        return true;
    }

    function scheduleMgtvWebFullscreenExitRepair() {
        cancelFullscreenEpisodeRefocus();
        const exitRepairToken = ++mgtvWebFullscreenExitRepairToken;
        const cleanupResidualWebFullscreenExit = () => {
            const scriptContainer = Array.from(document.querySelectorAll('.mgtv-script-web-fullscreen-container, .pip-web-fullscreen-container'))
                .find(node => node.dataset.mgtvScriptWebFullscreen === 'true');
            if (restoreScriptWebFullscreenContainer(scriptContainer)) return true;

            if (!document.body.classList.contains('pip-web-fs-active') &&
                !document.body.classList.contains('web-fs-active')) return false;

            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const normalPlayer = Array.from(document.querySelectorAll('#mgtv-player-wrap, .m-player-h5-new'))
                .find(node => {
                    if (node.closest('.pip-web-fullscreen-container')) return false;
                    const rect = node.getBoundingClientRect();
                    return rect.left > 8 &&
                        rect.top > 8 &&
                        rect.width > 300 &&
                        rect.height > 180 &&
                        rect.right <= viewportWidth + 80 &&
                        rect.bottom <= document.documentElement.scrollHeight + 80;
                });
            const fullscreenContainer = Array.from(document.querySelectorAll('.pip-web-fullscreen-container'))
                .find(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.width >= viewportWidth * 0.82 &&
                        rect.height >= viewportHeight * 0.72;
                });

            if (!normalPlayer || !fullscreenContainer) return false;

            const fullscreenPlayer = Array.from(fullscreenContainer.querySelectorAll('.mango-player, .mgtv-player'))
                .find(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 300 && rect.height > 180;
                });
            const hasPlayableVideo = !!fullscreenContainer.querySelector('video');
            if (fullscreenPlayer && !normalPlayer.contains(fullscreenPlayer)) {
                fullscreenPlayer.classList.remove('pip-web-fs-player', 'player-l');
                fullscreenPlayer.classList.add('player-m');
                ['width', 'height', 'max-width', 'max-height'].forEach(prop => {
                    try { fullscreenPlayer.style.removeProperty(prop); } catch (e) {}
                });
                normalPlayer.appendChild(fullscreenPlayer);
            } else if (hasPlayableVideo) {
                return false;
            }

            fullscreenContainer.remove();
            document.querySelectorAll('.mgtv-script-web-fullscreen-anchor, .pip-web-fullscreen-anchor').forEach(node => node.remove());
            finishWebFullscreenExitCleanup();
            return true;
        };

        [0, 80, 180, 520, 1000, 1600, 2400].forEach(delay => {
            setTimeout(() => {
                if (exitRepairToken !== mgtvWebFullscreenExitRepairToken) return;
                if (cleanupResidualWebFullscreenExit()) return;
                if (!document.body.classList.contains('pip-web-fs-active') &&
                    !document.body.classList.contains('web-fs-active')) return;

                const player = getPlayerRoot();
                if (!player) return;
                const rect = player.getBoundingClientRect();
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const stillLooksWebFullscreen = Math.abs(rect.x) < 4 &&
                    Math.abs(rect.y) < 4 &&
                    rect.width >= viewportWidth * 0.82 &&
                    rect.height >= viewportHeight * 0.72;
                if (stillLooksWebFullscreen) return;

                finishWebFullscreenExitCleanup();
            }, delay);
        });
    }

    function scheduleMgtvWebFullscreenEnterFallback() {
        mgtvWebFullscreenExitRepairToken += 1;
        const triggerWebFullscreen = () => {
            if (isAnyFullscreen()) return;
            if (document.body.classList.contains('pip-web-fs-active') ||
                document.body.classList.contains('web-fs-active')) return;

            const player = document.querySelector('#mgtv-player-wrap') || getPlayerRoot();
            if (player) {
                const rect = player.getBoundingClientRect();
                const eventOptions = {
                    bubbles: true,
                    clientX: Math.max(0, rect.left + rect.width / 2),
                    clientY: Math.max(0, rect.top + rect.height / 2)
                };
                player.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
                player.dispatchEvent(new MouseEvent('mouseover', eventOptions));
                player.dispatchEvent(new MouseEvent('mousemove', eventOptions));
            }

            const visibleButton = Array.from(document.querySelectorAll('.webfullscreenBtn, [class*="webfullscreen"], [class*="webFullscreen"], [class*="webZoom"]'))
                .find(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
            const webFullscreenButton = visibleButton ||
                document.querySelector('#mgtv-player-wrap .webfullscreenBtn') ||
                document.querySelector('.mango-player .webfullscreenBtn') ||
                document.querySelector('.mgtv-player .webfullscreenBtn') ||
                document.querySelector('.webfullscreenBtn');
            if (webFullscreenButton) {
                const rect = webFullscreenButton.getBoundingClientRect();
                const eventOptions = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: Math.max(0, rect.left + rect.width / 2),
                    clientY: Math.max(0, rect.top + rect.height / 2)
                };
                webFullscreenButton.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
                webFullscreenButton.dispatchEvent(new MouseEvent('mouseover', eventOptions));
                webFullscreenButton.dispatchEvent(new MouseEvent('mousedown', eventOptions));
                webFullscreenButton.dispatchEvent(new MouseEvent('mouseup', eventOptions));
                webFullscreenButton.click();
                setTimeout(ensureFullscreenEpisodeButton, 260);
            }
        };

        [80, 180, 320, 560, 900, 1400, 2200, 3200].forEach(delay => setTimeout(triggerWebFullscreen, delay));
        [650, 1200].forEach(delay => {
            setTimeout(() => {
                if (isAnyFullscreen()) return;
                if (document.body.classList.contains('pip-web-fs-active') ||
                    document.body.classList.contains('web-fs-active')) return;
                forceScriptWebFullscreenEnter();
            }, delay);
        });
    }

    function scrollFullscreenEpisodeCurrentIntoView() {
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        if (!panel || !panel.classList.contains('mgtv-fullscreen-episode-open')) return;
        const body = panel.querySelector('.mgtv-fullscreen-episode-body');
        const current = panel.querySelector('.mgtv-fullscreen-episode-current');
        if (!body || !current) return;
        const targetTop = current.offsetTop - body.clientHeight / 2 + current.offsetHeight / 2;
        body.scrollTop = Math.max(0, targetTop);
    }

    function toggleFullscreenEpisodePanel(forceOpen) {
        const button = document.getElementById('mgtv_fullscreen_episode_btn');
        let panel = document.getElementById('mgtv_fullscreen_episode_panel');
        const willOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !(panel && panel.classList.contains('mgtv-fullscreen-episode-open'));

        if (willOpen) {
            panel = syncFullscreenEpisodePanel();
        } else {
            panel = panel || ensureFullscreenEpisodePanel();
        }

        panel.classList.toggle('mgtv-fullscreen-episode-open', willOpen);
        if (button) button.classList.toggle('mgtv-fullscreen-episode-active', willOpen);
        if (willOpen) {
            requestAnimationFrame(scrollFullscreenEpisodeCurrentIntoView);
            setTimeout(scrollFullscreenEpisodeCurrentIntoView, 120);
        }
        if (!willOpen) {
            fullscreenEpisodeMonthSwitching = false;
            clearFullscreenEpisodeCloseTimer();
        }
    }

    function handleFullscreenEpisodePanelClick(e) {
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        if (!panel || !panel.contains(e.target)) return;

        const clonedItem = e.target.closest('li[data-vid]');
        const clonedLink = e.target.closest('a');
        if (!clonedItem && !clonedLink) return;

        const vid = clonedItem ? clonedItem.getAttribute('data-vid') : null;
        const href = clonedLink ? clonedLink.href : null;
        const sourceList = getPositiveVideoList();
        let sourceLink = null;

        if (sourceList && vid) {
            sourceLink = sourceList.querySelector(`li[data-vid="${vid}"] a`);
        }
        if (!sourceLink && sourceList && href) {
            sourceLink = Array.from(sourceList.querySelectorAll('a')).find(link => link.href === href);
        }
        if (!sourceLink) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        const wasNativeFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const wasFullscreen = isAnyFullscreen();
        toggleFullscreenEpisodePanel(false);
        releaseFullscreenEpisodeFocus();
        sourceLink.click();
        setTimeout(releaseFullscreenEpisodeFocus, 0);
        setTimeout(releaseFullscreenEpisodeFocus, 300);
        refocusFullscreenAfterEpisodeSwitch(wasFullscreen, wasNativeFullscreen);
    }

    document.addEventListener('click', handleFullscreenEpisodePanelClick, true);

    document.addEventListener('click', (e) => {
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        if (!panel || !panel.classList.contains('mgtv-fullscreen-episode-open')) return;
        if (fullscreenEpisodeMonthSwitching || Date.now() < fullscreenEpisodeKeepOpenUntil) return;

        const button = document.getElementById('mgtv_fullscreen_episode_btn');
        if ((button && button.contains(e.target)) || panel.contains(e.target)) return;

        toggleFullscreenEpisodePanel(false);
    }, true);

    function ensureFullscreenEpisodeButton() {
        const shouldShow = isAnyFullscreen();
        let button = document.getElementById('mgtv_fullscreen_episode_btn');
        if (button && button.dataset.mgtvEpisodeVersion !== FULLSCREEN_EPISODE_UI_VERSION) {
            button.remove();
            button = null;
        }
        const mount = getFullscreenEpisodeMount();
        const stateSignature = getFullscreenEpisodeStateSignature();
        const panel = document.getElementById('mgtv_fullscreen_episode_panel');
        const keepSwitchingPanel = fullscreenEpisodeMonthSwitching &&
            panel &&
            panel.classList.contains('mgtv-fullscreen-episode-open');
        if (fullscreenEpisodeStateSignature && fullscreenEpisodeStateSignature !== stateSignature && !keepSwitchingPanel) {
            removeFullscreenEpisodePanel();
        }
        fullscreenEpisodeStateSignature = stateSignature;

        if (!button) {
            button = document.createElement('div');
            button.id = 'mgtv_fullscreen_episode_btn';
            button.dataset.mgtvEpisodeVersion = FULLSCREEN_EPISODE_UI_VERSION;
            button.textContent = '选集';
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
            button.addEventListener('mouseenter', () => {
                clearFullscreenEpisodeCloseTimer();
                toggleFullscreenEpisodePanel(true);
            });
            button.addEventListener('mouseleave', () => scheduleFullscreenEpisodeClose());
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleFullscreenEpisodePanel();
            });
            button.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                toggleFullscreenEpisodePanel();
            });
        }

        if (mount.speedControl && mount.speedControl.parentElement) {
            if (button.parentNode !== mount.parent || button.previousElementSibling !== mount.speedControl) {
                mount.speedControl.insertAdjacentElement('afterend', button);
            }
        } else if (mount.beforeNode && mount.beforeNode.parentElement === mount.parent) {
            if (button.parentNode !== mount.parent || button.nextElementSibling !== mount.beforeNode) {
                mount.parent.insertBefore(button, mount.beforeNode);
            }
        } else if (button.parentNode !== mount.parent) {
            mount.parent.appendChild(button);
        }

        button.style.display = shouldShow ? 'flex' : 'none';
        if (!shouldShow) toggleFullscreenEpisodePanel(false);
        if (shouldShow) ensureFullscreenEpisodePanel();
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
        scheduleLocateCurrentVideoInPlaylist();
        attachEndedListener();
    }

    // --- 相似弹幕合并 ---
    class DanmuMergeManager {
        constructor() {
            this.storageKey = 'mgtv_danmu_merge_settings';
            this.settings = this.loadSettings();
            this.groups = [];
        }

        loadSettings() {
            const defaults = {
                enabled: true,
                windowSeconds: 20,
                showCount: true,
                minCountToShow: 2,
                enlargeAfter: 5,
                enlargeEnabled: true,
                similarityThreshold: 0.88
            };
            try {
                const saved = JSON.parse(localStorage.getItem(this.storageKey));
                return Object.assign({}, defaults, saved || {});
            } catch (e) {
                return defaults;
            }
        }

        saveSettings(settings) {
            const normalized = Object.assign({}, this.settings, settings || {});
            normalized.windowSeconds = this.clampNumber(normalized.windowSeconds, 1, 60, 20);
            normalized.minCountToShow = this.clampNumber(normalized.minCountToShow, 1, 99, 2);
            normalized.enlargeAfter = this.clampNumber(normalized.enlargeAfter, 1, 50, 5);
            this.settings = normalized;
            localStorage.setItem(this.storageKey, JSON.stringify(normalized));
        }

        clampNumber(value, min, max, fallback) {
            const n = Number(value);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(min, Math.min(max, Math.round(n)));
        }

        reset() {
            this.groups = [];
        }

        process(textSpan) {
            if (!this.settings.enabled || !textSpan || !textSpan.isConnected) return;

            const originalText = this.getOriginalText(textSpan);
            if (!originalText) return;

            const normalizedText = this.normalizeText(originalText);
            if (!normalizedText) return;

            const now = Date.now();
            this.cleanup(now);

            const matchedGroup = this.findSimilarGroup(normalizedText, now, textSpan);
            if (!matchedGroup) {
                this.groups.push(this.createGroup(textSpan, originalText, normalizedText, now));
                return;
            }

            const container = this.findDanmuContainer(textSpan);
            const hiddenTarget = container && container !== matchedGroup.container ? container : textSpan;
            this.hideMergedDanmu(hiddenTarget);

            matchedGroup.count += 1;
            matchedGroup.lastSeen = now;
            this.renderGroup(matchedGroup);
        }

        getOriginalText(textSpan) {
            if (!textSpan.dataset.mgtvOriginalDanmuText) {
                textSpan.dataset.mgtvOriginalDanmuText = textSpan.innerText.trim();
            }
            return textSpan.dataset.mgtvOriginalDanmuText.trim();
        }

        normalizeText(text) {
            return text
                .replace(/^×\d+\s*/, '')
                .replace(/^（\d+）\s*/, '')
                .replace(/^\(\d+\)\s*/, '')
                .replace(/[\s\u00a0]/g, '')
                .replace(/[，。！？!?,.;:~～、…·"'“”‘’【】[\]()（）<>《》|\\/_-]/g, '')
                .replace(/(.)\1{2,}/g, '$1$1')
                .toLowerCase()
                .trim();
        }

        createGroup(textSpan, originalText, normalizedText, now) {
            const container = this.findDanmuContainer(textSpan);
            const computedFontSize = parseFloat(window.getComputedStyle(textSpan).fontSize);
            return {
                textSpan,
                container,
                originalText,
                normalizedText,
                count: 1,
                createdAt: now,
                lastSeen: now,
                baseFontSize: Number.isFinite(computedFontSize) ? computedFontSize : null
            };
        }

        findSimilarGroup(normalizedText, now, currentTextSpan) {
            let best = null;
            let bestScore = 0;
            for (const group of this.groups) {
                if (group.textSpan === currentTextSpan) continue;
                if (!group.textSpan.isConnected) continue;
                if (group.container && group.container.style.display === 'none') continue;
                if (now - group.lastSeen > this.settings.windowSeconds * 1000) continue;

                const score = this.getSimilarity(normalizedText, group.normalizedText);
                if (score > bestScore) {
                    bestScore = score;
                    best = group;
                }
            }

            if (!best) return null;
            if (bestScore >= this.settings.similarityThreshold) return best;
            return null;
        }

        getSimilarity(a, b) {
            if (!a || !b) return 0;
            if (a === b) return 1;
            const minLen = Math.min(a.length, b.length);
            const maxLen = Math.max(a.length, b.length);
            if (minLen <= 3) return 0;
            if ((a.includes(b) || b.includes(a)) && maxLen - minLen <= 2) return 0.92;
            return 1 - (this.getLevenshteinDistance(a, b) / maxLen);
        }

        getLevenshteinDistance(a, b) {
            const costs = new Array(b.length + 1);
            for (let j = 0; j <= b.length; j++) costs[j] = j;

            for (let i = 1; i <= a.length; i++) {
                let prev = i - 1;
                costs[0] = i;
                for (let j = 1; j <= b.length; j++) {
                    const temp = costs[j];
                    costs[j] = a[i - 1] === b[j - 1]
                        ? prev
                        : Math.min(prev + 1, costs[j] + 1, costs[j - 1] + 1);
                    prev = temp;
                }
            }

            return costs[b.length];
        }

        hideMergedDanmu(element) {
            if (!element) return;
            if (!element.dataset.mgtvMergeHidden) {
                element.dataset.mgtvMergePreviousDisplay = element.style.display || '';
            }
            element.dataset.mgtvMergeHidden = 'true';
            element.style.display = 'none';
        }

        renderGroup(group) {
            if (!group.textSpan || !group.textSpan.isConnected) return;

            group.textSpan.dataset.mgtvMergeRendered = 'true';
            const shouldShowCount = this.settings.showCount && group.count > this.settings.minCountToShow;
            if (shouldShowCount) {
                const countSpan = document.createElement('span');
                countSpan.textContent = `(${group.count})`;
                countSpan.style.fontSize = '0.72em';
                countSpan.style.marginRight = '0.08em';
                countSpan.style.verticalAlign = 'baseline';
                group.textSpan.replaceChildren(countSpan, document.createTextNode(group.originalText));
            } else {
                group.textSpan.textContent = group.originalText;
            }
            group.textSpan.title = `${group.originalText}（已合并 ${group.count} 条）`;

            if (!this.settings.enlargeEnabled || !group.baseFontSize) return;
            const step = Math.floor((group.count - 1) / this.settings.enlargeAfter);
            const scale = Math.min(2.2, 1 + step * 0.18);
            group.textSpan.style.fontSize = `${group.baseFontSize * scale}px`;
            group.textSpan.style.fontWeight = step > 0 ? '700' : '';
        }

        restoreRenderedDanmu() {
            const rendered = document.querySelectorAll('[data-mgtv-merge-rendered="true"]');
            rendered.forEach(textSpan => {
                const originalText = textSpan.dataset.mgtvOriginalDanmuText;
                if (originalText) {
                    textSpan.textContent = originalText;
                }
                if (textSpan.title && textSpan.title.includes('已合并')) {
                    textSpan.removeAttribute('title');
                }
                textSpan.style.fontSize = '';
                textSpan.style.fontWeight = '';
                delete textSpan.dataset.mgtvMergeRendered;
            });

            const hidden = document.querySelectorAll('[data-mgtv-merge-hidden="true"]');
            hidden.forEach(element => {
                element.style.display = element.dataset.mgtvMergePreviousDisplay || '';
                delete element.dataset.mgtvMergePreviousDisplay;
                delete element.dataset.mgtvMergeHidden;
            });
        }

        cleanup(now) {
            const ttl = Math.max(this.settings.windowSeconds * 1000, 30000);
            this.groups = this.groups.filter(group => {
                if (!group.textSpan || !group.textSpan.isConnected) return false;
                if (group.container && !group.container.isConnected) return false;
                return now - group.lastSeen <= ttl;
            });
        }

        findDanmuContainer(textSpan) {
            let node = textSpan;
            let fallback = null;
            let hops = 0;
            while (node && hops < 8) {
                if (node.nodeType === 1) {
                    const cls = node.className && typeof node.className === 'string' ? node.className : '';
                    if (!fallback && node.tagName === 'DIV') fallback = node;
                    if (/danmu-?item|DanmuItem|barrage-?item|danmaku-?item/i.test(cls)) return node;
                }
                node = node.parentElement;
                hops++;
            }
            return fallback || textSpan.closest('div') || textSpan;
        }
    }

    function ensurePersistentTooltips() {
        const toggleButton = document.getElementById('autoDanmuToggleBtn');
        if (toggleButton) {
            addTooltip(toggleButton, '💡 是否自动关闭弹幕', 'left');
        }

        const settingsButton = document.getElementById('mgtv_blocklist_setting_btn');
        if (settingsButton) {
            addTooltip(settingsButton, '💡 弹幕增强设置', 'left');
        }

        const importButton = document.getElementById('mgtv_btn_import');
        if (importButton) {
            addTooltip(importButton, '💡 导入后新增合并当前已有的屏蔽词', 'top');
        }

        const exportButton = document.getElementById('mgtv_btn_export');
        if (exportButton) {
            addTooltip(exportButton, '💡 导出当前屏蔽词列表为 txt 文件', 'top');
        }
    }

    function init() {
        clearOldTooltips();
        closeDanmu();
        addDanmuShortcutTooltip();
        ensurePersistentTooltips();
        injectEpisodeTitleWrapStyle(); // 注入视频列表名称自动换行样式
        initPlaylistEnhance(); // 播放列表 Tab 记忆 & 跨月连播
        ensureFullscreenEpisodeButton(); // 全屏控制栏选集入口
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
            this.mergeManager = new DanmuMergeManager();
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
                const saved = typeof GM_getValue === 'function' ? GM_getValue(this.storageKey, null) : null;
                if (Array.isArray(saved)) return saved;
                if (typeof saved === 'string') return JSON.parse(saved) || [];

                const localSaved = JSON.parse(localStorage.getItem(this.storageKey)) || [];
                if (localSaved.length && typeof GM_setValue === 'function') {
                    GM_setValue(this.storageKey, localSaved);
                }
                return localSaved;
            } catch (e) {
                return [];
            }
        }

        save(list) {
            this.blocklist = list;
            this.compiledPatterns = this.compile(list); // 保存时同步更新预编译列表
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(this.storageKey, list);
                }
            } catch (e) {}
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(list));
            } catch (e) {}
            // 立即扫一遍当前屏幕上已存在的弹幕，使新规则即时生效
            try {
                const existing = document.querySelectorAll('[class*="danmuText"], [class*="DanmuText"]');
                existing.forEach(span => this.processDanmuText(span));
            } catch (e) {}
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
            addTooltip(btn, '💡 弹幕增强设置', 'left');
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
                max-height: 90vh;
                overflow: auto;
            `;

            // 芒果TV风格按钮样式
            const btnStyle = `padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; border: none; outline: none; transition: all 0.2s;`;
            const primaryBtnStyle = `${btnStyle} background: #FF5F00; color: #fff;`;
            const secondaryBtnStyle = `${btnStyle} background: transparent; color: #666; margin-right: 8px;`;

            content.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:18px; font-weight:600;">弹幕增强设置</h3>
                    <div id="mgtv_modal_close" style="cursor:pointer; font-size:20px; color:#999;">×</div>
                </div>
                
                <p style="font-size:13px; color:#666; margin-bottom:12px; line-height:1.5;">
                    每行一个屏蔽词。支持文本及正则表达式（如 <code style="background:#f5f5f5;padding:2px 4px;border-radius:4px;">/^haha\\d+$/i</code>）。
                </p>
                
                <textarea id="mgtv_blocklist_input" style="width:100%; height:200px; margin-bottom:16px; padding:12px; border:1px solid #ddd; border-radius:8px; font-family:monospace; font-size:14px; resize:vertical; box-sizing:border-box; outline:none;"></textarea>

                <div style="border:1px solid #eee; border-radius:8px; padding:12px; margin-bottom:16px; background:#fafafa;">
                    <div style="font-size:14px; font-weight:600; margin-bottom:10px;">弹幕合并</div>
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:8px;">
                        <input type="checkbox" id="mgtv_merge_enabled"> 启用相似弹幕合并
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:8px;">
                        时间阈值
                        <input type="number" id="mgtv_merge_window" min="1" max="60" step="1" style="width:64px; padding:4px 6px; border:1px solid #ddd; border-radius:4px;">
                        秒内的相似弹幕合并
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:8px;">
                        <input type="checkbox" id="mgtv_merge_show_count"> 显示弹幕数量标记
                        <span>仅当数量大于</span>
                        <input type="number" id="mgtv_merge_min_count" min="1" max="99" step="1" style="width:56px; padding:4px 6px; border:1px solid #ddd; border-radius:4px;">
                        <span>时显示</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
                        <input type="checkbox" id="mgtv_merge_enlarge"> 合并后增大字号，超过 5 条后逐级变大
                    </label>
                </div>
                
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
            const exportBtn = content.querySelector('#mgtv_btn_export');
            exportBtn.addEventListener('click', () => this.exportToFile());

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
            addBtnHover(exportBtn, '#f0f0f0');

            // 为导入/导出按钮添加自定义 Tooltip
            addTooltip(importBtn, '💡 导入后新增合并当前已有的屏蔽词', 'top');
            addTooltip(exportBtn, '💡 导出当前屏蔽词列表为 txt 文件', 'top');

            // 简单的Textarea focus样式
            const ta = document.getElementById('mgtv_blocklist_input');
            ta.addEventListener('focus', () => ta.style.borderColor = '#FF5F00');
            ta.addEventListener('blur', () => ta.style.borderColor = '#ddd');
        }

        openModal() {
            const modal = document.getElementById('mgtv_blocklist_modal');
            const textarea = document.getElementById('mgtv_blocklist_input');
            textarea.value = this.blocklist.join('\n');
            this.fillMergeSettingsUI();
            modal.style.display = 'flex';
        }

        fillMergeSettingsUI() {
            const settings = this.mergeManager.settings;
            const enabled = document.getElementById('mgtv_merge_enabled');
            const windowInput = document.getElementById('mgtv_merge_window');
            const showCount = document.getElementById('mgtv_merge_show_count');
            const minCount = document.getElementById('mgtv_merge_min_count');
            const enlarge = document.getElementById('mgtv_merge_enlarge');
            if (!enabled || !windowInput || !showCount || !minCount || !enlarge) return;

            enabled.checked = !!settings.enabled;
            windowInput.value = settings.windowSeconds;
            showCount.checked = !!settings.showCount;
            minCount.value = settings.minCountToShow;
            enlarge.checked = !!settings.enlargeEnabled;
        }

        saveMergeSettingsFromUI() {
            const enabled = document.getElementById('mgtv_merge_enabled');
            const windowInput = document.getElementById('mgtv_merge_window');
            const showCount = document.getElementById('mgtv_merge_show_count');
            const minCount = document.getElementById('mgtv_merge_min_count');
            const enlarge = document.getElementById('mgtv_merge_enlarge');
            if (!enabled || !windowInput || !showCount || !minCount || !enlarge) return;

            this.mergeManager.restoreRenderedDanmu();
            this.mergeManager.saveSettings({
                enabled: enabled.checked,
                windowSeconds: windowInput.value,
                showCount: showCount.checked,
                minCountToShow: minCount.value,
                enlargeEnabled: enlarge.checked
            });
            this.mergeManager.reset();
        }

        saveFromUI() {
            const textarea = document.getElementById('mgtv_blocklist_input');
            const raw = textarea.value.split('\n').map(s => s.trim()).filter(s => s);
            const unique = [...new Set(raw)];
            this.saveMergeSettingsFromUI();
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
                            this.checkAndProcess(node);
                        }
                    }
                }
            });

            this.reAnchorObserver();
        }

        // 性能核心：锚定到稳定的弹幕层容器进行监听；找不到则不监听，避免监听 body 导致内存/CPU 爆炸
        reAnchorObserver() {
            // 优先匹配稳定且持久的弹幕层容器（而非单条弹幕气泡）
            // - mango-danmu-layer: 老版/稳定类名
            // - _DanmuLayer_xxx: 新版 CSS Modules 生成的弹幕层
            // - .m-danmu-container / .danmu-container: 历史类名
            let target = document.querySelector('.mango-danmu-layer') ||
                document.querySelector('[class*="DanmuLayer"]') ||
                document.querySelector('.m-danmu-container') ||
                document.querySelector('.danmu-container');

            if (!target) {
                // 兜底：从弹幕文本 span 向上寻找，但必须命中 Layer/Container 级别，跳过 Item/Track 等会被销毁的子节点
                const sampleDanmu = document.querySelector('[class*="danmuText"], [class*="DanmuText"]');
                if (sampleDanmu) {
                    let node = sampleDanmu.parentElement;
                    let hops = 0;
                    while (node && hops < 8) {
                        const cls = node.className && typeof node.className === 'string' ? node.className : '';
                        if (/danmu-?layer|danmu-?container|danma-?layer|barrage-?layer/i.test(cls)) {
                            target = node;
                            break;
                        }
                        node = node.parentElement;
                        hops++;
                    }
                }
            }

            if (!target) {
                // 找不到精准容器：断开监听，等待下一轮轮询再尝试，绝不回退到 body
                if (this.container) {
                    this.observer.disconnect();
                    this.container = null;
                }
                return;
            }

            if (this.container !== target) {
                if (this.observer) this.observer.disconnect();
                this.container = target;
                if (this.mergeManager) this.mergeManager.reset();
                this.observer.observe(target, { childList: true, subtree: true });
            }
        }

        checkAndProcess(node) {
            // 快速检查：如果节点本身是弹幕文本 span
            if (node.classList && [...node.classList].some(c => /danmuText/i.test(c))) {
                this.processDanmuText(node);
                return;
            }
            // 否则尝试在子节点中寻找一次（不进行深度递归，仅一级 querySelector）
            const textSpan = node.querySelector ? node.querySelector('[class*="danmuText"], [class*="DanmuText"]') : null;
            if (textSpan) {
                this.processDanmuText(textSpan);
            }
        }

        processDanmuText(textSpan) {
            if (this.performBlock(textSpan)) return;
            this.mergeManager.process(textSpan);
        }

        performBlock(textSpan) {
            const text = (textSpan.dataset.mgtvOriginalDanmuText || textSpan.innerText).trim();
            if (this.shouldBlock(text)) {
                // 尝试隐藏最外层容器（通常是 ._danmuItem...），如果找不到就隐藏 span 本身
                // 使用 closest 可以更精准地找到弹幕条目
                const container = textSpan.closest('div') || textSpan;
                container.style.display = 'none';
                return true;
            }
            return false;
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
        ensureFullscreenEpisodeButton();
        
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
        if (!video) {
            // 页面上已无 video 元素：主动释放旧引用，避免持有已被移除的 HTMLMediaElement 及其 MediaSource
            if (currentObservedVideo) {
                videoSrcObserver.disconnect();
                currentObservedVideo = null;
            }
            return;
        }
        if (video !== currentObservedVideo) {
            currentObservedVideo = video;
            videoSrcObserver.disconnect();
            videoSrcObserver.observe(video, { attributes: true, attributeFilter: ['src'] });
        }
    }
})();

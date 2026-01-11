// ==UserScript==
// @name         芒果TV网页版自动关闭弹幕
// @namespace    http://tampermonkey.net/
// @version      1.17.15
// @description  自动关闭芒果TV视频弹幕，支持切换集数后自动关闭弹幕，用户可选择启用或禁用功能，支持快捷键 D 手动开启/关闭弹幕
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

    let autoCloseDanmu = JSON.parse(localStorage.getItem('autoCloseDanmu')) ?? true;
    let networkErrorFlag = false;
    let lastUrl = window.location.href;

    function createTooltip(text, direction = 'top') {
        const tooltip = document.createElement('div');
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
        if (!button || button.dataset.tooltipAttached) return;
        button.dataset.tooltipAttached = 'true';

        const tooltip = createTooltip(text, direction);
        document.body.appendChild(tooltip);

        button.addEventListener('mouseenter', () => {
            // 关键修复：全屏模式下，必须将 Tooltip 移动到全屏元素内部，否则会被遮挡
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
        });

        button.addEventListener('mouseleave', () => {
            tooltip.style.opacity = '0';
        });
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

        // 左侧显示 tooltip（不使用 title）
        addTooltip(button, '💡 是否自动关闭弹幕', 'left');
    }

    function closeDanmu() {
        if (!autoCloseDanmu) return;
        const danmuButtonOn = document.querySelector("._danmuSwitcher_1qow5_208._on_1qow5_238");
        if (danmuButtonOn) {
            danmuButtonOn.click();
            console.log("弹幕已关闭");
        }
    }

    function toggleDanmu() {
        const btn = document.querySelector("._danmuSwitcher_1qow5_208");
        if (btn) {
            btn.click();
            console.log("快捷键切换弹幕");
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
        // 芒果TV的全屏按钮通常有 title="全屏" 或 "退出全屏"
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

    function addDanmuShortcutTooltip() {
        const danmuButtons = document.querySelectorAll("._danmuSwitcher_1qow5_208");
        danmuButtons.forEach(btn => {
            if (!btn || btn.dataset.tooltipAttached) return;
            // 使用默认上方 tooltip
            addTooltip(btn, "💡 按 D 键可开关弹幕", 'top');
        });
    }

    // 监听动态添加的 DOM 节点（用于捕获自定义 Tooltip）
    // 使用 mouseover + XPath 查找可见的 Tooltip 元素
    // 这种方式比 MutationObserver 更精准地覆盖 "文字已存在但隐藏" 的情况
    document.addEventListener('mouseover', () => {
        // 给一点延时让 Tooltip 渲染/显示
        setTimeout(() => {
            // 查找所有包含 "全屏" 或 "退出全屏" 或 "弹幕" 相关文本的元素
            // 使用 XPath 查找：全匹配全屏/退出全屏，模糊匹配弹幕
            const xpath = "//*[text()='全屏' or text()='退出全屏' or contains(text(), '弹幕')]";
            const result = document.evaluate(xpath, document.body, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);

            for (let i = 0; i < result.snapshotLength; i++) {
                const node = result.snapshotItem(i);
                // 检查元素是否可见 (offsetParent 不为 null 代表可见)
                if (node.offsetParent !== null) {
                    const text = node.innerText.trim();
                    if (text === '全屏') {
                        node.innerText = '全屏 (F)';
                    } else if (text === '退出全屏') {
                        node.innerText = '退出全屏 (F)';
                    } else if (text.includes('弹幕') && text.length <= 5 && !text.includes('(D)')) {
                        // 模糊匹配：只要包含弹幕且长度短（防止误伤长句子），就追加 (D)
                        node.innerText = text + ' (D)';
                    }
                }
            }
        }, 50);
    });

    function init() {
        closeDanmu();
        addDanmuShortcutTooltip();
    }

    window.addEventListener('load', init);

    const originalConsoleError = console.error;
    console.error = function (...args) {
        originalConsoleError.apply(console, args);
        if (args.some(arg => typeof arg === 'string' && /^Ne/.test(arg))) {
            networkErrorFlag = true;
            closeDanmu();
        }
    };

    const playerElement = document.querySelector(".mango-player.p-MacIntel.player-s");
    if (playerElement) {
        playerElement.addEventListener('click', () => {
            if (autoCloseDanmu && networkErrorFlag) {
                setTimeout(() => {
                    closeDanmu();
                    networkErrorFlag = false;
                }, 3000);
            }
        });
    }

    // 优化：使用定时轮询代替点击事件监听，以更稳定地检测 URL 变化，避免频繁触发定时器
    setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            init();
        }
        // 持续尝试添加弹幕快捷键提示（应对播放器全屏切换/重绘导致按钮重建）
        addDanmuShortcutTooltip();
    }, 1000);

    // 防抖函数，避免频繁触发
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    const debouncedInit = debounce(init, 3000);

    const titleObserver = new MutationObserver(debouncedInit);

    const titleElement = document.querySelector('title');
    if (titleElement) {
        titleObserver.observe(titleElement, { childList: true });
    }

    createToggleIconButton();
})();

/*
 Copyright 2020 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

// Core Web Vitals thresholds
const LCP_THRESHOLD = 2500;
const FID_THRESHOLD = 100;
const INP_THRESHOLD = 200;
const CLS_THRESHOLD = 0.1;

/**
 * Hash the URL and return a numeric hash as a String to be used as the key
 * @param {String} str
 * @return {String} hash
 */
function hashCode(str) {
  let hash = 0;
  if (str.length === 0) {
    return '';
  }
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

/**
 * Call vitals.js to begin collecting local WebVitals metrics.
 * This will cause the content script to emit an event that kicks off the badging flow.
 * @param {Number} tabId
 */
function getWebVitals(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['src/browser_action/vitals.js'],
  }, (result) => {
    // Catch errors such as "This page cannot be scripted due
    // to an ExtensionsSettings policy."
  });
}

// User has navigated to a new URL in a tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const tabIdKey = tabId.toString();

  if (tab.active) {
    chrome.storage.local.set({[tabIdKey]: false});
  } else {
    chrome.storage.local.set({[tabIdKey]: true}); // tab was loaded in background
  }

  if (
    changeInfo.status == 'complete' &&
    tab.url.startsWith('http') &&
    tab.active
  ) {
    getWebVitals(tabId);
  }
});

// User has made a new or existing tab visible
chrome.tabs.onActivated.addListener(({tabId, windowId}) => {
  getWebVitals(tabId);
});


/**
 *
 * Update the badge icon based on the overall WebVitals
 * pass rate (i.e good = green icon, poor = red icon)
 * @param {String} badgeCategory - GOOD or POOR
 * @param {Number} tabid
 */
function badgeOverallPerf(badgeCategory, tabid) {
  chrome.tabs.query({
    active: true,
    currentWindow: true,
  }, function(tabs) {
    const currentTab = tabid || tabs[0].id;

    switch (badgeCategory) {
      case 'POOR':
        chrome.action.setIcon({
          path: '../../icons/slow128w.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: '',
          tabId: currentTab,
        });
        break;
      case 'GOOD':
        chrome.action.setIcon({
          path: '../../icons/fast128w.png',
          tabId: currentTab,
        });
        break;
      default:
        chrome.action.setIcon({
          path: '../../icons/default128w.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: '',
          tabId: currentTab,
        });
        break;
    }
  });
}

/**
 *
 * Badge the icon for a specific metric
 * @param {String} metric
 * @param {Number} value
 * @param {Number} tabid
 */
function badgeMetric(metric, value, tabid) {
  chrome.tabs.query({
    active: true,
    currentWindow: true,
  }, function(tabs) {
    const currentTab = tabid || tabs[0].id;
    const bgColor = '#000';

    // If URL is overall failing the thresholds, only show
    // a red badge for metrics actually failing (issues/22)
    if (metric === 'cls' && value <= CLS_THRESHOLD) {
      return;
    }
    if (metric === 'lcp' && value <= LCP_THRESHOLD) {
      return;
    }
    if (metric === 'fid' && value <= FID_THRESHOLD) {
      return;
    }

    switch (metric) {
      case 'lcp':
        chrome.action.setIcon({
          path: '../../icons/slow128w-lcp.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeBackgroundColor({
          color: bgColor,
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: (value / 1000).toFixed(2),
          tabId: currentTab,
        });
        break;
      case 'cls':
        chrome.action.setIcon({
          path: '../../icons/slow128w-cls.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeBackgroundColor({
          color: bgColor,
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: (value).toFixed(2),
          tabId: currentTab,
        });
        break;
      case 'fid':
        chrome.action.setIcon({
          path: '../../icons/slow128w-fid.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeBackgroundColor({
          color: bgColor,
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: value.toFixed(2),
          tabId: currentTab,
        });
        break;
      default:
        chrome.action.setIcon({
          path: '../../icons/default128w.png',
          tabId: currentTab,
        });
        chrome.action.setBadgeBackgroundColor({
          color: '',
          tabId: currentTab,
        });
        chrome.action.setBadgeText({
          text: '',
          tabId: currentTab,
        });
        break;
    }
  });
}

/**
 * Wait ms milliseconds
 *
 * @param {Number} ms
 * @return {Promise}
 */
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {number} tabId
 * @return {Promise<boolean>}
 */
function doesTabExist(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, () => resolve(!chrome.runtime.lastError));
  });
}

/** @type {number} */
let globalAnimationId = 0;
/** @type {Map<number, number>} */
const animationsByTabId = new Map();

/**
 * Animate badges between pass/fail -> each failing metric.
 * We track each animation by tabId so that we can handle "cancellation" of the animation on new information.
 * @param {Object} request
 * @param {Number} tabId
 */
async function animateBadges(request, tabId) {
  const animationId = globalAnimationId;
  animationsByTabId.set(tabId, animationId);
  globalAnimationId++;

  const delay = 2000;
  // First badge overall perf
  badgeOverallPerf(request.passesAllThresholds, tabId);
  // If perf is poor, animate the sequence
  if (request.passesAllThresholds === 'POOR') {
    await wait(delay);
    if (animationsByTabId.get(tabId) !== animationId) return;
    badgeMetric('lcp', request.metrics.lcp.value, tabId);

    await wait(delay);
    if (animationsByTabId.get(tabId) !== animationId) return;
    badgeMetric('fid', request.metrics.fid.value, tabId);

    await wait(delay);
    if (animationsByTabId.get(tabId) !== animationId) return;
    badgeMetric('cls', request.metrics.cls.value, tabId);

    // Loop the animation if no new information came in while we animated.
    await wait(delay);
    if (animationsByTabId.get(tabId) !== animationId) return;
    // Stop animating if the tab is gone
    if (!(await doesTabExist(tabId))) return;
    animateBadges(request, tabId);
  }
}

// message from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.passesAllThresholds !== undefined) {
    // e.g passesAllThresholds === 'GOOD' => green badge
    animateBadges(request, sender.tab.id);
    // Store latest metrics locally only.
    // The popup will load the metric values from this storage.
    if (sender.tab.url) {
      const key = hashCode(sender.tab.url);
      chrome.storage.local.set({[key]: request.metrics});
    }
    // send TabId to content script
    sendResponse({tabId: sender.tab.id});
  }
});

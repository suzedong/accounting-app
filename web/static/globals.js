/**
 * Globals Bridge: ESM modules → window globals
 * 允许 HTML 页面中的 inline <script> 块正常工作。
 * 此文件由 <script type="module"> 加载，ESM 会 defer，所以
 * inline 脚本中的初始化调用需要延迟执行。
 */

import { NOCOBASE_CONFIG } from './config.js';
import * as Utils from './utils.js';
import * as NocobaseAPI from './nocobase-api.js';
import * as AIParser from './ai-parser.js';
import * as ParseJS from './parse.js';
import * as LearningEngine from './learning-engine.js';
import * as AgentCore from './agent-core.js';
import * as ChatWidget from './chat-widget.js';

// Expose all as globals for inline scripts
window.NOCOBASE_CONFIG = NOCOBASE_CONFIG;
window.formatMoney = Utils.formatMoney;
window.formatDatetime = Utils.formatDatetime;
window.setActiveNav = Utils.setActiveNav;
window.Paginator = Utils.Paginator;
window.formatDate = Utils.formatDate;
window.getDateRange = Utils.getDateRange;
window.filterRecords = Utils.filterRecords;
window.statsByCategory = Utils.statsByCategory;
window.calcTotals = Utils.calcTotals;
window.statsByAccount = Utils.statsByAccount;
window.analyzeBudget = Utils.analyzeBudget;
window.monthlyBudgetStats = Utils.monthlyBudgetStats;
window.monthlyTrend = Utils.monthlyTrend;
window.comparison = Utils.comparison;
window.heatmapData = Utils.heatmapData;

window.NocobaseAPI = NocobaseAPI;
window.AIParser = AIParser;
window.parseInput = ParseJS.parseInput;
window.formatRecord = ParseJS.formatRecord;
window.LearningEngine = LearningEngine;
window.AgentCore = AgentCore;
window.ChatWidget = ChatWidget;

// 标记已加载，inline 脚本检查此标志
window.__globalsLoaded = true;
window.__globalsReady = Promise.resolve();

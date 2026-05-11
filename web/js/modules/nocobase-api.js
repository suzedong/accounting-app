/**
 * NocoBase API 客户端封装
 * 请求通过 Vite/server.py 代理转发到 NocoBase，认证由后端注入。
 */

import { NOCOBASE_CONFIG } from './config.js';
const C = NOCOBASE_CONFIG.COLLECTIONS;

    async function request(method, path, body = null, params = null) {
        // 使用相对路径，通过代理转发到 NocoBase
        // 路径必须以 /api/ 开头才能被代理
        let url = path.startsWith('/api/') ? path : '/api' + path;

        // 添加查询参数
        if (params) {
            const qs = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value !== null && value !== undefined) {
                    qs.append(key, value);
                }
            }
            const qsStr = qs.toString();
            if (qsStr) url += (url.includes('?') ? '&' : '?') + qsStr;
        }

        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API ${method} ${path} 失败 (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    /**
     * 将 NocoBase filter 对象转换为 URL 参数
     * NocoBase 格式: filter[field][操作符]=值
     */
    function buildFilterParams(filters) {
        const params = {};
        if (!filters) return params;

        for (const [key, value] of Object.entries(filters)) {
            if (value !== null && value !== undefined && value !== '') {
                params[`filter[${key}]`] = value;
            }
        }
        return params;
    }

    // ==================== Records ====================

    async function getRecords(options = {}) {
        const { page = 1, pageSize = 20, filters = {}, sort = '-datetime' } = options;

        const params = {
            page,
            pageSize,
            sort,
            ...buildFilterParams(filters)
        };

        return request('GET', `/${C.RECORDS}`, null, params);
    }

    async function getRecord(id) {
        return request('GET', `/${C.RECORDS}/${id}`);
    }

    async function createRecord(data) {
        return request('POST', `/${C.RECORDS}`, data);
    }

    async function updateRecord(id, data) {
        return request('PATCH', `/${C.RECORDS}/${id}`, data);
    }

    async function deleteRecord(id) {
        return request('POST', `/${C.RECORDS}:destroy/${id}`);
    }

    // ==================== Categories ====================

    async function getCategories() {
        return request('GET', `/${C.CATEGORIES}`, null, { pageSize: 100, sort: 'sort_order' });
    }

    // ==================== Accounts ====================

    async function getAccounts() {
        return request('GET', `/${C.ACCOUNTS}`, null, { pageSize: 100, sort: 'sort_order' });
    }

    // ==================== Payment Methods ====================

    async function getPaymentMethods() {
        return request('GET', `/${C.PAYMENT_METHODS}`, null, { pageSize: 100, sort: 'sort_order' });
    }

    // ==================== Business Trip ====================

    async function getBusinessTrips(status = null) {
        const params = { pageSize: 10000, sort: '-start_date' };
        if (status) params['filter[status]'] = status;
        return request('GET', `/${C.BUSINESS_TRIP}`, null, params);
    }

    // ==================== 聚合统计 ====================

    /**
     * NocoBase aggregate API 用于统计
     * 注意: 具体格式可能因 NocoBase 版本而异
     * 如果 aggregate 不可用，前端直接计算统计数据
     */
    async function aggregate(collection, params) {
        return request('POST', `/${collection}:aggregate`, params);
    }

    // ==================== 高级查询（用于统计分析） ====================

    /**
     * 获取指定时间范围内的所有记录（用于前端统计计算）
     * NocoBase 可能不支持复杂的 GROUP BY 聚合，所以获取原始数据在前端计算
     */
    async function getRecordsForStats(datetimeFrom, datetimeTo, account = null) {
        const params = {
            pageSize: 10000,
            sort: '-datetime',
            'filter[datetime][$gte]': datetimeFrom
        };

        if (datetimeTo) {
            params['filter[datetime][$lte]'] = datetimeTo;
        }

        if (account) {
            params['filter[account]'] = account;
        }

        return request('GET', `/${C.RECORDS}`, null, params);
    }

    // ==================== Generic Collection Operations ====================

    async function getCollection(collectionName, options = {}) {
        const { pageSize = 20, sort = '-id', filters = {} } = options;
        const params = { pageSize, ...buildFilterParams(filters) };
        if (sort) params.sort = sort;
        return request('GET', `/${collectionName}`, null, params);
    }

    async function createRecordInCollection(collectionName, data) {
        return request('POST', `/${collectionName}`, data);
    }

export {
    request,
    // Records
    getRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
    // Config data
    getCategories,
    getAccounts,
    getPaymentMethods,
    // Business trip
    getBusinessTrips,
    // Stats
    aggregate,
    getRecordsForStats,
    // Generic collection operations (for learning_data etc.)
    getCollection,
    createRecordInCollection
};

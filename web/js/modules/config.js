/**
 * 前端配置
 * NocoBase Token 和 AI Key 由 server.py 统一管理，前端不持有敏感凭证。
 */
export const NOCOBASE_CONFIG = {
    BUDGET_MONTHLY: 3500,
    COLLECTIONS: {
        RECORDS: 'records',
        CATEGORIES: 'categories',
        ACCOUNTS: 'accounts',
        PAYMENT_METHODS: 'payment_methods',
        BUDGETS: 'budgets',
        BUSINESS_TRIP: 'business_trip',
        LEARNING_DATA: 'learning_data'
    }
};

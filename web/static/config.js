/**
 * NocoBase 配置
 */
export const NOCOBASE_CONFIG = {
    API_URL: 'http://121.17.49.100:13000/api',
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4',
    BUDGET_MONTHLY: 3500,
    COLLECTIONS: {
        RECORDS: 'records',
        CATEGORIES: 'categories',
        ACCOUNTS: 'accounts',
        PAYMENT_METHODS: 'payment_methods',
        BUDGETS: 'budgets',
        BUSINESS_TRIP: 'business_trip',
        LEARNING_DATA: 'learning_data'
    },
    AI_CONFIG: {
        API_URL: 'https://coding.dashscope.aliyuncs.com/v1',
        API_KEY: 'sk-sp-4cf0ff7b598444949af23ee397b4cdf9',
        MODEL: 'qwen3.6-plus'
    }
};

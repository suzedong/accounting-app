/**
 * NocoBase 配置
 * 部署到 NAS 时修改此文件中的 NOCOBASE_API_URL 和 NOCOBASE_API_TOKEN
 */
const NOCOBASE_CONFIG = {
    // NocoBase API 地址（末尾不要加斜杠）
    API_URL: 'http://121.17.49.100:13000/api',

    // API Token（NocoBase JWT，有效期 1 年，到期后需重新生成）
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4',

    // 默认月度预算（元）
    BUDGET_MONTHLY: 3500,

    // Collection 名称映射
    COLLECTIONS: {
        RECORDS: 'records',
        CATEGORIES: 'categories',
        ACCOUNTS: 'accounts',
        PAYMENT_METHODS: 'payment_methods',
        BUDGETS: 'budgets',
        BUSINESS_TRIP: 'business_trip',
        LEARNING_DATA: 'learning_data'
    },

    // 阿里云百炼 AI 配置（用于智能记账解析）
    AI_CONFIG: {
        API_URL: 'https://coding.dashscope.aliyuncs.com/v1',
        API_KEY: 'sk-sp-4cf0ff7b598444949af23ee397b4cdf9',
        MODEL: 'qwen3.6-plus'
    }
};

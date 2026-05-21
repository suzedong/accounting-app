/**
 * 分类关键词映射表
 * 用于从自然输入推断记账分类
 */

export const categoryKeywords: Record<string, string[]> = {
  // 餐饮
  '餐饮': ['吃', '餐', '饭', '菜', '早餐', '午餐', '晚餐', '午饭', '晚饭', '面条', '火锅', '烧烤', '奶茶', '咖啡', '外卖', '零食', '水果', '超市', '便利店', '麦当劳', '肯德基', '星巴克', '瑞幸', '蜜雪'],

  // 交通
  '交通': ['地铁', '公交', '打车', '滴滴', '加油', '停车', '充电', '过路费', '高速费', '火车票', '机票', '高铁', '出租车', '共享单车', '哈啰', '青桔'],

  // 购物
  '购物': ['淘宝', '京东', '拼多多', '天猫', '衣服', '鞋', '包', '电子产品', '手机', '电脑', '耳机', '键盘', '鼠标', '显示器', '日用品'],

  // 住房
  '住房': ['房租', '物业费', '水电费', '燃气费', '网费', '宽带', '维修', '家具', '家电'],

  // 通讯
  '通讯': ['话费', '手机费', '流量', '月租', '短信', '电话'],

  // 娱乐
  '娱乐': ['电影', '游戏', 'KTV', '旅游', '门票', '演唱会', '演出', '酒吧', '桌游', '剧本杀', '密室'],

  // 医疗
  '医疗': ['药', '医院', '看病', '挂号', '体检', '牙科', '眼科', '疫苗', '保险'],

  // 教育
  '教育': ['书', '培训', '课程', '学费', '考试', '证书', '教材', '资料'],

  // 人情
  '人情': ['红包', '礼金', '份子钱', '请客', '送礼', '随礼'],

  // 工资
  '工资': ['工资', '薪水', '月薪', '底薪', '奖金', '年终奖', '绩效', '提成'],

  // 报销
  '报销': ['报销', '差旅', '出差补助', '补贴'],

  // 理财
  '理财': ['利息', '收益', '分红', '股息', '基金', '股票', '定投'],
};

/**
 * 根据输入文本推断分类
 */
export function inferCategory(text: string): string | undefined {
  const lower = text.toLowerCase();

  // For expense types, search expense categories
  // For income types, search income categories
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return category;
      }
    }
  }

  return undefined;
}

/**
 * 获取所有分类列表
 */
export function getAllCategories(): string[] {
  return Object.keys(categoryKeywords);
}

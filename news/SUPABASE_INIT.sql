-- Supabase 初始化脚本 - 创建每日资讯表
-- 在 Supabase SQL Editor 中执行此脚本

-- 创建资讯表
CREATE TABLE IF NOT EXISTS public.news (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()),
  title TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  category TEXT CHECK (category IN ('IT', 'Finance', 'Auto')),
  image_url TEXT,
  article_url TEXT UNIQUE,
  published_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_news_published_at ON public.news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON public.news(category);
CREATE INDEX IF NOT EXISTS idx_news_date_category ON public.news(published_at DESC, category);

-- 启用 Row Level Security
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

-- 删除旧策略（如果存在）
DROP POLICY IF EXISTS "Allow public read" ON public.news;
DROP POLICY IF EXISTS "Deny public modify" ON public.news;

-- 创建新策略
-- 允许所有人读取
CREATE POLICY "Allow public read"
ON public.news
FOR SELECT
USING (true);

-- 禁止所有人通过 API 直接修改（只能通过后端 Service Role 修改）
CREATE POLICY "Deny public insert"
ON public.news
FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny public update"
ON public.news
FOR UPDATE
USING (false);

CREATE POLICY "Deny public delete"
ON public.news
FOR DELETE
USING (false);

-- 插入测试数据（可选）
INSERT INTO public.news (title, summary, source, category, article_url, published_at) VALUES
  ('ChatGPT-5 正式发布，性能提升 3 倍', 'OpenAI 今日宣布发布 ChatGPT-5，在推理和编程能力上取得突破性进展。最新版本在代码生成、数学运算等方面表现优异。', 'AI News', 'IT', 'https://openai.com/blog/chatgpt-5', NOW()),
  ('苹果发布 M4 Ultra 芯片，性能翻倍', '苹果在 WWDC 2026 大会上宣布推出全新 M4 Ultra 芯片，采用最新的 3nm 工艺，性能相比上一代提升 100%。', 'Tech Daily', 'IT', 'https://apple.com/newsroom/m4-ultra', NOW() - INTERVAL '1 hour'),
  ('比特币突破 $100K，机构投资增加 50%', '全球加密货币市场迎来新一轮上涨，比特币创历史新高。机构投资者持仓比例创新高，显示市场信心增强。', 'Crypto News', 'Finance', 'https://example.com/crypto-news-1', NOW() - INTERVAL '2 hours'),
  ('美联储维持利率不变，市场反应积极', '美联储在最新利率决议中决定维持基准利率不变，暗示后续可能开始降息周期。', 'Finance Daily', 'Finance', 'https://example.com/fed-news', NOW() - INTERVAL '3 hours'),
  ('特斯拉发布新款电动车 Model X 2027，续航里程达 1000km', '特斯拉推出全新车型，搭载最新一代 4680 电池，电池技术革新实现超长续航，售价为 $35,999。', 'Auto Weekly', 'Auto', 'https://tesla.com/model-x-2027', NOW() - INTERVAL '4 hours'),
  ('比亚迪新能源车销量突破 300 万辆', '比亚迪宣布其新能源汽车累计销量突破 300 万辆大关，成为全球首个达到此里程碑的汽车制造商。', 'Auto News', 'Auto', 'https://example.com/byd-sales', NOW() - INTERVAL '5 hours'),
  ('微软推出 Copilot Pro 企业版，支持自定义模型', '微软为企业用户推出 Copilot Pro 企业版本，允许客户使用自己的数据训练专属 AI 模型。', 'Tech News', 'IT', 'https://microsoft.com/copilot-pro-enterprise', NOW() - INTERVAL '6 hours'),
  ('投资者看好新兴市场，资金流入创记录', '国际投资者对新兴市场的兴趣回升，今年资金流入量创 5 年新高，中国和印度成主要目标。', 'Global Finance', 'Finance', 'https://example.com/emerging-markets', NOW() - INTERVAL '7 hours'),
  ('蔚来、小鹏、理想新车预订量齐创新高', '国内三大造车新势力在 2026 年上半年的新车预订量均创历史新高，市场竞争进一步加剧。', 'EV News', 'Auto', 'https://example.com/chinese-ev-makers', NOW() - INTERVAL '8 hours'),
  ('英伟达发布新一代 GPU，AI 性能提升 5 倍', '英伟达推出全新架构 GPU，专门针对 AI 推理优化，性能相比上一代提升 500%。', 'Hardware News', 'IT', 'https://nvidia.com/hopper-next-gen', NOW() - INTERVAL '9 hours'),
  ('央行宣布数字人民币试点城市扩大至 50 个', '中国央行宣布进一步扩大数字人民币试点范围，已覆盖全国 50 个城市，用户数突破 5000 万。', 'Finance Update', 'Finance', 'https://example.com/cbdc-expansion', NOW() - INTERVAL '10 hours'),
  ('宝马推出纯电动 i7，将在华销售', '宝马集团正式发布纯电动旗舰轿车 i7，续航超 700km，将在中国、欧洲和北美市场销售。', 'Luxury Cars', 'Auto', 'https://bmw.com/i7-launch', NOW() - INTERVAL '11 hours')
ON CONFLICT (article_url) DO NOTHING;

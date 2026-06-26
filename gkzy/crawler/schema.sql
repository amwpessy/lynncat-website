-- 高考志愿填报系统 · 数据库结构 (SQLite)
-- 数据源：掌上高考 api.zjzw.cn（公开接口），覆盖 2021–2025 五年。
PRAGMA journal_mode = WAL;

-- ── 院校基础信息（约 2991 所本/专科） ──
CREATE TABLE IF NOT EXISTS schools (
  school_id     INTEGER PRIMARY KEY,   -- 掌上高考院校ID
  name          TEXT NOT NULL,
  province_name TEXT,                  -- 院校所在省
  city_name     TEXT,
  level_name    TEXT,                  -- 本科 / 专科
  nature_name   TEXT,                  -- 公办 / 民办 / 中外合作
  belong        TEXT,                  -- 主管部门
  f985          INTEGER DEFAULT 0,     -- 是否985
  f211          INTEGER DEFAULT 0,     -- 是否211
  dual_class    TEXT,                  -- 双一流标识
  dual_class_name TEXT,
  code_enroll   TEXT,                  -- 招生代码
  raw           TEXT                   -- 原始JSON留档
);

-- ── 院校投档/录取线（考生省 × 年 × 批次 × 科类） ──
CREATE TABLE IF NOT EXISTS college_score (
  local_province_id   INTEGER NOT NULL,  -- 考生所在省(GB码)
  local_province_name TEXT,
  year                INTEGER NOT NULL,
  school_id           INTEGER NOT NULL,
  school_name         TEXT,
  local_batch_name    TEXT,              -- 本科一批 / 本科批 / 专科批…
  local_type_name     TEXT,             -- 理科/文科 或 物理类/历史类
  special_group       TEXT,             -- 专业组(新高考)
  sg_name             TEXT,             -- 专业组名/选科
  sg_info             TEXT,
  min_score           INTEGER,          -- 最低分(投档线)
  min_section         INTEGER,          -- 最低位次
  proscore            INTEGER,          -- 当年省控线
  diff                INTEGER,          -- 线差(min - proscore)
  raw                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_cs_lookup
  ON college_score(local_province_id, year, local_type_name, min_section);
CREATE INDEX IF NOT EXISTS idx_cs_school
  ON college_score(school_id, local_province_id);

-- ── 专业录取线（考生省 × 年 × 院校 × 专业(组)） ──
CREATE TABLE IF NOT EXISTS major_score (
  special_id          INTEGER,           -- 掌上高考专业记录ID(去重用)
  local_province_id   INTEGER NOT NULL,
  local_province_name TEXT,
  year                INTEGER NOT NULL,
  school_id           INTEGER NOT NULL,
  school_name         TEXT,
  spname              TEXT,              -- 专业全称(含备注)
  sp_name             TEXT,             -- 专业短名
  level2_name         TEXT,             -- 学科门类(工学/理学…)
  level3_name         TEXT,             -- 专业类(计算机类…)
  local_batch_name    TEXT,
  local_type_name     TEXT,
  special_group       TEXT,
  min_score           INTEGER,
  max_score           INTEGER,
  avg_score           INTEGER,
  min_section         INTEGER,           -- 最低位次
  proscore            INTEGER,
  info                TEXT,              -- 包含专业/办学地点说明
  raw                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_ms_lookup
  ON major_score(local_province_id, year, local_type_name, min_section);
CREATE INDEX IF NOT EXISTS idx_ms_school
  ON major_score(school_id, local_province_id, year);

-- ── 抓取断点：记录每个分区是否已完成，支持中断续抓 ──
CREATE TABLE IF NOT EXISTS crawl_state (
  kind       TEXT NOT NULL,   -- 'schools' | 'college' | 'major'
  part_key   TEXT NOT NULL,   -- 分区键，如 '41|2024'(省|年) 或 '140|2024'(校|年)
  status     TEXT NOT NULL,   -- 'done'
  rows       INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (kind, part_key)
);

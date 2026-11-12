from dataclasses import dataclass


@dataclass(frozen=True)
class Product:
    slug: str
    identifier: int
    name: str
    category: str
    region: str
    actions: tuple[str, ...]
    entry: str


PRODUCTS = (
    Product("ztgh", 9, "电话营销·国内", "电话营销", "国内", ("call_minute", "ai_generate"), "https://ztgh.taikua.cn/api/v1/platform/sso"),
    Product("ztwh", 10, "电话营销·海外", "电话营销", "海外", ("call_minute", "ai_generate"), "https://ztwh.taikua.cn/api/v1/platform/sso"),
    Product("ztgj", 11, "社媒矩阵·国内", "社媒矩阵", "国内", ("social_publish", "ai_generate"), "https://ztgj.taikua.cn/api/auth/sso"),
    Product("ztwj", 12, "社媒矩阵·海外", "社媒矩阵", "海外", ("social_publish", "ai_generate"), "https://ztwj.taikua.cn/api/auth/sso"),
    Product("ztgt", 13, "拓客转私域·国内", "拓客转私域", "国内", ("lead_search", "ai_generate", "mail_send"), "https://ztgt.taikua.cn/api/auth/sso"),
    Product("ztwt", 14, "拓客转私域·海外", "拓客转私域", "海外", ("lead_search", "ai_generate", "mail_send", "wa_send"), "https://ztwt.taikua.cn/api/auth/sso"),
    Product("site", 15, "独立站", "独立站", "国内", ("site_generate", "ai_generate"), "https://dlz.taikua.cn/api/auth/sso"),
)
PRODUCT_BY_SLUG = {product.slug: product for product in PRODUCTS}

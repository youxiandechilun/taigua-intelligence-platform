from ..catalog import PRODUCT_BY_SLUG
from ..config.mapper import audit
from ..errors import PlatformError
from ..identity.mapper import product
from ..runtime import Core
from . import mapper


def prices(core: Core, slug: str | None = None) -> list[dict[str, str | int]]:
    with core.connection() as connection:
        rows = mapper.list_prices(connection, slug)
    return [dict(row) for row in rows]


def update_price(core: Core, slug: str, action: str, points: int, cap: int, admin_id: int, admin_name: str) -> None:
    definition = PRODUCT_BY_SLUG.get(slug)
    if not definition or action not in definition.actions:
        raise PlatformError("ACTION_UNCONFIGURED", "该产品不支持此收费动作")
    with core.connection(write=True) as connection:
        agent = product(connection, slug)
        if not agent:
            raise PlatformError("AGENT_NOT_FOUND", "产品不存在", 404)
        mapper.save_price(connection, agent["id"], action, points, cap)
        audit(connection, admin_id, admin_name, "更新动作价格", slug, action, core.now())


def consumptions(core: Core, merchant_id: int | None, page: int, size: int) -> dict[str, object]:
    with core.connection() as connection:
        rows, total = mapper.list_consumptions(connection, merchant_id, page, size)
    return {"list": [dict(row) for row in rows], "total": total, "page": page, "pageSize": size}

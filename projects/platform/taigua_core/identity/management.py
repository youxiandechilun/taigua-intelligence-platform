from ..errors import PlatformError
from ..runtime import Core
from . import management_mapper, mapper


def remove_merchant(core: Core, mid: int) -> str:
    with core.connection(write=True) as connection:
        merchant = mapper.merchant(connection, mid)
        if not merchant or merchant["role"] != "merchant":
            raise PlatformError("MERCHANT_NOT_FOUND", "商家不存在", 404)
        if merchant["point_frozen"] or management_mapper.has_financial_records(connection, mid):
            raise PlatformError("MERCHANT_HAS_RECORDS", "商家已有充值、消费、授权订单或额度预留记录，请使用停用保留历史账目", 409)
        management_mapper.remove_unbilled_merchant(connection, mid)
        return merchant["company"]

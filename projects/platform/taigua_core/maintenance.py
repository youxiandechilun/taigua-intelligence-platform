import argparse
import time

from .billing.service import release_expired


def main() -> None:
    parser = argparse.ArgumentParser(description="平台数据库升级和到期额度回收")
    parser.add_argument("--once", action="store_true")
    options = parser.parse_args()
    from app import create_app

    application = create_app()
    core = application.extensions["taigua_core"]
    while True:
        released = release_expired(core)
        if released:
            application.logger.info("已回收过期额度记录 %d 条", released)
        if options.once:
            return
        time.sleep(30)


if __name__ == "__main__":
    main()

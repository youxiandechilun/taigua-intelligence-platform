/*
 * 中文导读：共享基础能力的 login-bg 组件，封装该界面的展示与交互。
 */
const ROWS = Array.from({ length: 7 }, (_, index) => index);
const LOGOS = Array.from({ length: 5 }, (_, index) => index);

export default function LoginBg() {
  return (
    <div className="taigua-logo-wall">
      <span className="sr-only">泰卦数字员工</span>
      <div className="taigua-logo-wall-mask" aria-hidden="true">
        <div className="taigua-logo-wall-tilt">
          {ROWS.map((row) => (
            <div key={row} className={`taigua-logo-wall-row ${row % 2 ? "taigua-logo-wall-row-reverse" : ""}`}>
              {[0, 1].map((copy) => (
                <div key={copy} className="taigua-logo-wall-group">
                  {LOGOS.map((logo) => (
                    <div key={logo} className="taigua-logo-wall-item">
                      <span className={`taigua-logo-wall-artwork taigua-logo-wall-artwork-${row % 3 === 2 ? "far" : row % 3 === 1 ? "middle" : "near"}`} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

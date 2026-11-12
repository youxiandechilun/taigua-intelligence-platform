/* 泰卦插件的 Windows 单入口：运行环境封装在程序内，不要求员工寻找脚本或安装 Python。 */
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>

static HWND main_window;
static const char config_magic[16] = "TAIGUA-CONFIG-01";
static const char payload_magic[16] = "TAIGUA-PAYLOAD01";
static wchar_t failure[300] = L"插件启动失败，请重新从系统设置下载并解压。";

static int copy_bytes(FILE *source, FILE *target, uint64_t length) {
    /* 分块提取，启动时不额外占用整个运行包大小的内存。 */
    unsigned char buffer[65536];
    while (length) {
        size_t size = length > sizeof(buffer) ? sizeof(buffer) : (size_t)length;
        if (fread(buffer, 1, size, source) != size || fwrite(buffer, 1, size, target) != size) return 0;
        length -= size;
    }
    return 1;
}

static int run_program(wchar_t *command, const wchar_t *directory, int visible) {
    /* 子进程不弹命令行黑框；准备进度和错误由可见窗口展示。 */
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW;
    startup.wShowWindow = visible ? SW_SHOWNORMAL : SW_HIDE;
    if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, directory, &startup, &process)) return 0;
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return exit_code == 0;
}

static void remove_scratch(const wchar_t *directory) {
    /* 仅清理由本次启动创建的随机临时目录，不触碰下载文件、员工素材或浏览器数据。 */
    wchar_t list[1024] = {0};
    wcsncpy(list, directory, 1021);
    SHFILEOPSTRUCTW operation = {0};
    operation.wFunc = FO_DELETE;
    operation.pFrom = list;
    operation.fFlags = FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT;
    SHFileOperationW(&operation);
}

static int prepare(void) {
    wchar_t self[1024], temporary[1024], scratch[1024] = {0}, zip[1200], config_path[1200];
    wchar_t system[1024], command[4096], program[1200];
    FILE *source = NULL, *output = NULL;
    uint64_t config_size, zip_size;
    char magic[16];
    int ok = 0;
    GetModuleFileNameW(NULL, self, 1024);
    source = _wfopen(self, L"rb");
    if (!source || _fseeki64(source, -24, SEEK_END)) goto done;
    __int64 file_size = _ftelli64(source) + 24;
    if (fread(&config_size, 8, 1, source) != 1 || fread(magic, 1, 16, source) != 16 ||
        memcmp(magic, config_magic, 16) || config_size > 65536 || file_size < (__int64)config_size + 48) {
        wcscpy(failure, L"下载包缺少员工信息，请从当前员工的系统设置重新下载。");
        goto done;
    }
    __int64 config_offset = file_size - 24 - config_size;
    if (_fseeki64(source, config_offset - 24, SEEK_SET) || fread(&zip_size, 8, 1, source) != 1 ||
        fread(magic, 1, 16, source) != 16 || memcmp(magic, payload_magic, 16) ||
        !zip_size || zip_size > (uint64_t)(config_offset - 24)) goto done;
    GetTempPathW(1024, temporary);
    if (!GetTempFileNameW(temporary, L"tge", 0, scratch)) goto done;
    DeleteFileW(scratch);
    if (!CreateDirectoryW(scratch, NULL)) goto done;
    swprintf(zip, 1200, L"%ls\\runtime.zip", scratch);
    output = _wfopen(zip, L"wb");
    if (!output || _fseeki64(source, config_offset - 24 - zip_size, SEEK_SET) || !copy_bytes(source, output, zip_size)) goto done;
    fclose(output); output = NULL;
    /* 使用系统自带解压能力，不下载脚本，也不修改 PowerShell 执行策略。 */
    SetEnvironmentVariableW(L"TAIGUA_SETUP_ZIP", zip);
    SetEnvironmentVariableW(L"TAIGUA_SETUP_DIR", scratch);
    GetSystemDirectoryW(system, 1024);
    swprintf(command, 4096, L"\"%ls\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -NonInteractive -Command \"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:TAIGUA_SETUP_ZIP -DestinationPath $env:TAIGUA_SETUP_DIR -Force\"", system);
    if (!run_program(command, scratch, 0)) {
        wcscpy(failure, L"无法准备运行环境，请检查磁盘空间，并确认系统允许使用自带的 PowerShell 解压功能。");
        goto done;
    }
    swprintf(program, 1200, L"%ls\\program", scratch);
    swprintf(config_path, 1200, L"%ls\\activation.json", program);
    output = _wfopen(config_path, L"wb");
    if (!output || _fseeki64(source, config_offset, SEEK_SET) || !copy_bytes(source, output, config_size)) goto done;
    fclose(output); output = NULL;
    fclose(source); source = NULL;
    SetEnvironmentVariableW(L"PYTHONHOME", NULL);
    SetEnvironmentVariableW(L"PYTHONPATH", NULL);
    swprintf(command, 4096, L"\"%ls\\runtime\\pythonw.exe\" \"%ls\\install_executor.py\"", program, program);
    /* Python 窗口接管后显示真实连接状态；后台运行目录留在员工自己的用户目录。 */
    PostMessageW(main_window, WM_APP + 2, 0, 0);
    if (!run_program(command, program, 1)) {
        wcscpy(failure, L"运行环境未能启动，请重新下载；当前版本支持 Windows 10/11 的 64 位系统。");
        goto done;
    }
    ok = 1;
done:
    if (output) fclose(output);
    if (source) fclose(source);
    if (scratch[0]) remove_scratch(scratch);
    return ok;
}

static DWORD WINAPI setup_thread(void *unused) {
    /* 解压和程序复制在工作线程中进行，窗口保持可响应。 */
    (void)unused;
    PostMessageW(main_window, WM_APP + 1, prepare(), 0);
    return 0;
}

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_APP + 1) {
        if (!wparam) MessageBoxW(window, failure, L"泰卦插件", MB_OK | MB_ICONERROR);
        DestroyWindow(window);
        return 0;
    }
    if (message == WM_APP + 2 || message == WM_CLOSE) {
        ShowWindow(window, SW_HIDE);
        return 0;
    }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wparam, lparam);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show) {
    /* 单个图标双击即开始准备，无地址输入、手动连接或管理员提权。 */
    (void)previous; (void)arguments;
    INITCOMMONCONTROLSEX controls = {sizeof(controls), ICC_PROGRESS_CLASS};
    InitCommonControlsEx(&controls);
    WNDCLASSW type = {0};
    type.lpfnWndProc = window_proc;
    type.hInstance = instance;
    type.hCursor = LoadCursorW(NULL, IDC_ARROW);
    type.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    type.lpszClassName = L"TaiguaExecutorSetup";
    RegisterClassW(&type);
    main_window = CreateWindowW(type.lpszClassName, L"泰卦插件", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                                CW_USEDEFAULT, CW_USEDEFAULT, 500, 210, NULL, NULL, instance, NULL);
    HWND title = CreateWindowW(L"STATIC", L"正在准备首次启动，请稍候……", WS_CHILD | WS_VISIBLE,
                              28, 30, 440, 32, main_window, NULL, instance, NULL);
    HFONT font = CreateFontW(-20, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, 0, 0, 0, 0, L"Microsoft YaHei");
    SendMessageW(title, WM_SETFONT, (WPARAM)font, TRUE);
    HWND progress = CreateWindowW(PROGRESS_CLASSW, NULL, WS_CHILD | WS_VISIBLE | PBS_MARQUEE,
                                  28, 85, 430, 16, main_window, NULL, instance, NULL);
    SendMessageW(progress, PBM_SETMARQUEE, TRUE, 25);
    ShowWindow(main_window, show);
    HANDLE thread = CreateThread(NULL, 0, setup_thread, NULL, 0, NULL);
    if (!thread) return 1;
    CloseHandle(thread);
    MSG message;
    while (GetMessageW(&message, NULL, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    DeleteObject(font);
    return 0;
}

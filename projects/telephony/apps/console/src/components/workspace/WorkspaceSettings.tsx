/*
 * 中文导读：工作区与权限的 WorkspaceSettings 组件，封装该界面的展示与交互。
 */
'use client';

import { useState, type ChangeEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ImagePlus , RefreshCw, Save } from 'lucide-react';
import { authClient } from '@/src/lib/auth-client';
import {
  useWorkspaceProfile,
  workspaceApi,
  type DashboardAnnouncement,
  type WorkspaceProfile,
  type WorkspaceProfileInput,
} from '@/src/lib/api/resources/workspace';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { toast } from '@/src/lib/toast';

const defaultAnnouncement: DashboardAnnouncement = {
  text: '',
  color: '#b83240',
  enabled: true,
  speed: 'normal',
};

export function WorkspaceSettings() {
  const profile = useWorkspaceProfile();

  return (
    <div className="space-y-5">
      {profile.isLoading ? (
        <p className="text-sm text-muted-foreground">正在加载公司设置…</p>
      ) : profile.error ? (
        <div role="alert" className="rounded border p-5">
          <p>{profile.error.message}</p>
          <Button className="mt-3" variant="outline" onClick={() => void profile.refetch()}><RefreshCw aria-hidden="true" className="size-4" />
            重新加载
          </Button>
        </div>
      ) : profile.data ? (
        <ProfileForm key={profile.data.organizationId} profile={profile.data} />
      ) : null}
    </div>
  );
}

function editableProfile(profile: WorkspaceProfile): WorkspaceProfileInput {
  return {
    workspaceName: profile.workspaceName,
    companyName: profile.companyName,
    brandName: profile.brandName,
    address: profile.address,
    businessDescription: profile.businessDescription,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    logo: profile.logo,
    dashboardAnnouncement: profile.dashboardAnnouncement ?? defaultAnnouncement,
  };
}

function ProfileForm({ profile }: { profile: WorkspaceProfile }) {
  const initial = editableProfile(profile);
  const [data, setData] = useState<WorkspaceProfileInput>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgs = authClient.useListOrganizations();
  const activeOrg = authClient.useActiveOrganization();
  const dirty = JSON.stringify(data) !== JSON.stringify(initial);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('请选择小于 5MB 的 PNG、JPG 或 WebP 图片。');
      return;
    }
    setUploading(true);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 800 / bitmap.width, 240 / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器无法读取图片，请更换图片。');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const logo = canvas.toDataURL('image/png');
      if (logo.length > 460000) throw new Error('图片处理后仍过大，请使用尺寸更小的 Logo。');
      setData((current) => ({ ...current, logo }));
      toast.success('Logo 已预览，点击保存后生效。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片无法读取，请更换图片。');
    } finally {
      bitmap?.close();
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await workspaceApi.save(profile.organizationId, data);
      queryClient.setQueriesData<WorkspaceProfile>({ queryKey: ['workspace-profile'] }, (old) =>
        old?.organizationId === result.organizationId ? result : old,
      );
      await Promise.all([
        orgs.refetch(),
        activeOrg.refetch(),
        queryClient.invalidateQueries({ queryKey: ['agents', 'templates'] }),
      ]);
      setData(editableProfile(result));
      router.refresh();
      toast.success('当前工作区的公司与品牌设置已保存。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function update(key: keyof WorkspaceProfileInput, value: string) {
    setData((current) => ({ ...current, [key]: value }));
  }


  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-sm font-semibold">公司资料与品牌</h2>
      {!profile.canEdit && (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm">
          当前账号可查看公司资料；保存设置需要工作区管理员权限。
        </p>
      )}
      <form onSubmit={save} className="mt-6 space-y-6">
        <fieldset disabled={busy || !profile.canEdit} className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                ['workspaceName', '工作区名称', '用于工作区列表与切换', 80],
                ['companyName', '公司全称', '用于新智能体话术中的身份介绍', 120],
                ['brandName', '品牌名称', '用于后台 Logo 旁及浏览器标题', 80],
                ['website', '公司官网', 'https://公司官网', 2000],
              ] as const
            ).map(([key, label, hint, max]) => (
              <label key={key} className="grid gap-2 text-sm font-medium">
                <span>{label}</span>
                <Input
                  value={data[key]}
                  onChange={(e) => update(key, e.target.value)}
                  required={key === 'workspaceName' || key === 'companyName'}
                  type={key === 'website' ? 'url' : 'text'}
                  maxLength={max}
                  placeholder={hint}
                />
              </label>
            ))}
          </div>

          <div className="grid gap-3">
            <span className="text-sm font-medium">公司 Logo</span>
            <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed bg-white p-4">
              {data.logo ? (
                <Image
                  src={data.logo}
                  alt="当前工作区 Logo 预览"
                  width={800}
                  height={240}
                  unoptimized
                  className="max-h-20 w-auto max-w-full object-contain"
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Building2 className="size-5" />
                  未上传，界面将显示品牌名称
                </div>
              )}
            </div>
            <label className="grid gap-2 text-sm">
              <span className="flex items-center gap-2">
                <ImagePlus className="size-4" />
                {uploading ? '正在处理图片…' : '上传或更换 Logo'}
              </span>
              <Input
                type="file"
                aria-label="上传公司 Logo"
                aria-describedby="company-logo-requirements"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploading}
                onChange={(e) => void upload(e)}
              />
            </label>
            <p id="company-logo-requirements" className="text-xs leading-5 text-muted-foreground">建议尺寸 800 × 240 px，横版比例约 10:3；推荐透明背景 PNG。支持 PNG / JPG / WebP，最大 5MB，其他尺寸会等比适配。</p>
            {data.logo && (
              <Button type="button" variant="outline" className="w-fit" onClick={() => setData((current) => ({ ...current, logo: null }))}>
                取消使用此 Logo
              </Button>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                ['phone', '公司联系电话', 40],
                ['email', '公司邮箱', 254],
                ['address', '公司地址', 200],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="grid gap-2 text-sm font-medium">
                {label}
                <Input
                  value={data[key]}
                  onChange={(e) => update(key, e.target.value)}
                  type={key === 'email' ? 'email' : 'text'}
                  maxLength={max}
                />
              </label>
            ))}
          </div>

          <label className="grid gap-2 text-sm font-medium">
            公司介绍 / 经营业务
            <Textarea
              rows={5}
              maxLength={4000}
              value={data.businessDescription}
              onChange={(e) => update('businessDescription', e.target.value)}
              placeholder="介绍本公司的产品、业务与服务范围"
            />
          </label>


        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t pt-5">
          <Button disabled={busy || uploading || !profile.canEdit || !dirty} type="submit"><Save aria-hidden="true" className="size-4" />
            {busy ? '正在保存…' : '保存公司与品牌设置'}
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">有修改尚未保存</span>}
        </div>
      </form>
    </section>
  );
}

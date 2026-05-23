import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Organization } from '../types';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';

interface OrgSelectProps {
  onSelect: (orgId: string, orgName: string) => void;
  selectedOrgId: string | null;
}

export default function OrgSelect({ onSelect, selectedOrgId }: OrgSelectProps) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrgs() {
      try {
        const data = await api<{ orgs: Organization[]; error?: string }>('/api/organizations');
        if (data.error) {
          throw new Error(data.error);
        }
        setOrgs(data.orgs);
      } catch (e: any) {
        setError(e.message || '获取学校列表失败');
      } finally {
        setLoading(false);
      }
    }
    fetchOrgs();
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 animate-fade-in">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-semibold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary mb-3">
          选择学校
        </h2>
        <p className="text-sm text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
          选择您所在的学校或组织以继续登录
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Loader2 className="animate-spin mb-3 w-8 h-8 stroke-[1.5]" />
          <span className="text-xs">正在加载学校列表...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-sm text-red-500 bg-red-50/50 dark:bg-red-950/20 rounded-2xl border border-red-100 dark:border-red-950/30">
          {error}
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-20 text-sm text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
          暂无可用学校
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => {
            const isSelected = selectedOrgId === org.id;
            return (
              <button
                key={org.id}
                onClick={() => onSelect(org.id, org.name)}
                className={`w-full text-left p-6 rounded-2xl border apple-transition apple-hover flex items-center justify-between
                  ${
                    isSelected
                      ? 'border-apple-blue-light dark:border-apple-blue-dark bg-neutral-50 dark:bg-apple-bg-darkSec'
                      : 'border-neutral-100 dark:border-neutral-900 bg-white dark:bg-apple-bg-darkSec hover:bg-neutral-50 dark:hover:bg-neutral-900/50'
                  }
                `}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                    <Building2 size={18} className="stroke-[1.5]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                      {org.name}
                    </h3>
                    <p className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-0.5">
                      组织代码: {org.id}
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-neutral-400" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

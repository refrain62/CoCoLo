// 現在サイトで利用できる操作だけを、ログイン前でも確認できる利用者向けマニュアルとして公開する。
export function UserManualPage() {
  return (
    <>
      <header>
        <p>CoCoLo ご利用ガイド</p>
        <h1>CoCoLo 操作マニュアル</h1>
        <p>
          このページでは、CoCoLoで現在利用できるログイン・部員管理・年度繰り上げの操作を説明します。
        </p>
        <nav aria-label="マニュアル操作">
          <a href="/login">ログイン・部員管理へ戻る</a>
        </nav>
      </header>

      <nav aria-label="マニュアル目次" className="manual-toc">
        <h2>目次</h2>
        <ul>
          <li>
            <a href="#first">はじめに</a>
          </li>
          <li>
            <a href="#login">ログイン</a>
          </li>
          <li>
            <a href="#members">部員一覧を確認する</a>
          </li>
          <li>
            <a href="#register">部員を登録する</a>
          </li>
          <li>
            <a href="#promotion">年度繰り上げを実行する</a>
          </li>
          <li>
            <a href="#safety">安全に利用する</a>
          </li>
          <li>
            <a href="#trouble">困ったときは</a>
          </li>
        </ul>
      </nav>

      <article className="manual-content">
        <section id="first" aria-labelledby="first-heading">
          <h2 id="first-heading">はじめに</h2>
          <p>
            画面上部に環境名が表示されている場合は、接続先を確認してください。staging（検証環境）とproduction（本番環境）を間違えないよう、登録や年度繰り上げの前に確認します。
          </p>
          <p>
            「環境未設定」と表示される場合は、登録や年度繰り上げなどの重要操作を行わず、チーム管理者へ確認してください。
          </p>
          <p>
            表示できる部員や実行できる操作は、ログインしている利用者のチーム所属と権限で決まります。画面に表示されない情報を、別の方法で取得しようとしないでください。
          </p>
        </section>

        <section id="login" aria-labelledby="login-heading">
          <h2 id="login-heading">ログイン</h2>
          <ol>
            <li>ログイン画面で登録済みのメールアドレスを入力します。</li>
            <li>パスワードを入力し、「ログイン」を押します。</li>
            <li>ログインに成功すると、所属チームの部員一覧が表示されます。</li>
          </ol>
          <p>
            ログインに失敗した場合は、メールアドレスとパスワードを確認してください。解決しない場合は、チーム管理者へ連絡してください。
          </p>
        </section>

        <section id="members" aria-labelledby="members-heading">
          <h2 id="members-heading">部員一覧を確認する</h2>
          <p>「部員一覧」では、所属チームの部員を確認できます。</p>
          <ol>
            <li>氏名またはふりがなを「検索」に入力します。</li>
            <li>必要に応じて「区分」や「状態」を選択します。</li>
            <li>「検索」を押すと、条件に一致する一覧が表示されます。</li>
          </ol>
          <p>
            学生の学年は学年表示、一般の部員は年代表示になります。電話番号、保護者識別子、特記事項など、権限によっては表示されない情報があります。
          </p>
          <table>
            <caption>権限ごとの部員一覧の範囲</caption>
            <thead>
              <tr>
                <th scope="col">権限</th>
                <th scope="col">確認できる範囲</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">オーナー・管理者・スタッフ</th>
                <td>所属チームの部員</td>
              </tr>
              <tr>
                <th scope="row">保護者</th>
                <td>担当している部員</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section id="register" aria-labelledby="register-heading">
          <h2 id="register-heading">部員を登録する</h2>
          <p>
            部員登録は、オーナーまたは管理者（owner / admin）だけが実行できます。部員一覧の「部員を登録」を押して入力欄を開きます。
          </p>
          <ol>
            <li>氏名を入力します。</li>
            <li>必要に応じてふりがなを入力します。</li>
            <li>「区分」で学生または一般を選びます。</li>
            <li>学生は学年、一般は年代を入力します。</li>
            <li>状態を選び、「登録する」を押します。</li>
          </ol>
          <ul>
            <li>学生の学年は1〜16の整数で入力します。</li>
            <li>一般を選んだ場合は年代を入力し、学年は入力しません。</li>
            <li>登録が成功したときだけ、部員一覧へ反映されます。</li>
            <li>
              チームID、部員ID、特記事項は入力しません。システムが管理します。
            </li>
          </ul>
          <p>
            登録ボタンを押した後に通信が切れた場合、同じ部員をすぐに再登録しないでください。まず一覧を検索し、登録済みでないことを確認してから管理者へ相談してください。
          </p>
        </section>

        <section id="promotion" aria-labelledby="promotion-heading">
          <h2 id="promotion-heading">年度繰り上げを実行する</h2>
          <p>
            年度繰り上げは、オーナーまたは管理者（owner / admin）向けの操作です。年度末など、チームで実行時期と対象年度を確認してから行ってください。
          </p>
          <ol>
            <li>「対象年度」に2000〜2100の整数を入力します。</li>
            <li>「対象件数を確認」を押し、対象人数を確認します。</li>
            <li>対象人数と内容に問題がなければ「確認して実行」を押します。</li>
            <li>確認ダイアログで実行を確定します。</li>
          </ol>
          <p>対象になるのは、次の条件をすべて満たす部員です。</p>
          <ul>
            <li>在籍中である。</li>
            <li>区分が学生である。</li>
            <li>学年が登録されている。</li>
          </ul>
          <p>
            一般、停止、退部、学年未設定の部員は対象外です。学年を一律に1つ上げ、繰り上げ後の学年が17以上の場合は「OB / 院生」と表示します。卒業・留年・退部は自動判定しません。
          </p>
          <p>
            同じ年度の処理を再度実行しても、保存済みの結果を使って二重更新を防ぎます。実行後は表示された完了人数を確認してください。
          </p>
        </section>

        <section id="safety" aria-labelledby="safety-heading">
          <h2 id="safety-heading">安全に利用する</h2>
          <ul>
            <li>アカウントやパスワードを他の人と共有しないでください。</li>
            <li>
              staging（検証環境）とproduction（本番環境）を間違えないよう、操作前に環境表示を確認してください。
            </li>
            <li>
              必要な権限がない情報を、スクリーンショットや別の方法で共有しないでください。
            </li>
            <li>
              登録や年度繰り上げは、対象と結果を確認してから確定してください。
            </li>
            <li>
              現在は画面上のログアウト操作がないため、共有端末では利用せず、個人の端末を使ってください。
            </li>
          </ul>
        </section>

        <section id="trouble" aria-labelledby="trouble-heading">
          <h2 id="trouble-heading">困ったときは</h2>
          <table>
            <caption>よくある状況と対応</caption>
            <thead>
              <tr>
                <th scope="col">状況</th>
                <th scope="col">対応</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">ログインできない</th>
                <td>
                  入力内容を確認し、解決しなければチーム管理者へ連絡する。
                </td>
              </tr>
              <tr>
                <th scope="row">権限エラーになる</th>
                <td>自分のチーム所属と権限を管理者に確認する。</td>
              </tr>
              <tr>
                <th scope="row">一覧が空になる</th>
                <td>
                  検索・絞り込み条件を解除し、対象範囲と所属チームを確認する。
                </td>
              </tr>
              <tr>
                <th scope="row">通信エラーが表示される</th>
                <td>
                  画面を再読み込みし、登録操作は重複確認後に再試行する。解決しなければ管理者へ連絡する。
                </td>
              </tr>
              <tr>
                <th scope="row">年度繰り上げの人数が想定と違う</th>
                <td>
                  対象年度、在籍状態、区分、学年の登録内容を確認し、実行前なら確定しない。
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>

      <footer className="manual-footer">
        <p>
          このマニュアルは、サイトで現在提供している機能を対象にしています。
        </p>
        <a href="/login">ログイン・部員管理へ戻る</a>
      </footer>
    </>
  );
}
